use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use tauri_plugin_sql::{Migration, MigrationKind};

mod fetch_opra;
mod fetch_specs;

/// XDG directory name used for all application data (see spec: the app
/// strictly follows the XDG Base Directory Specification).
const APP_DIR_NAME: &str = "audio-vault";

/// Build a localized note/error string: a stable code (mapped to a
/// `notes.<code>` key in the frontend catalogs). The frontend shows unknown
/// codes as-is, so a frontend/Rust version mismatch degrades gracefully.
pub(crate) fn note(code: &str) -> String {
  code.to_string()
}

/// Like [`note`], but with positional JSON parameters rendered as `{{p0}}`,
/// `{{p1}}`, … by the frontend (e.g. `spec.search_failed:["…"]`).
pub(crate) fn note_with(code: &str, params: serde_json::Value) -> String {
  format!("{code}:{params}")
}

/// Resolved XDG paths for the application.
#[derive(serde::Serialize, Clone, Debug)]
pub struct AppPaths {
  /// `~/.local/share/audio-vault/collection.db`
  pub db: String,
  /// `~/.local/share/audio-vault/media/`
  pub media: String,
  /// `~/.config/audio-vault/config.json`
  pub config: String,
}

/// Application settings persisted to `config.json`. Missing fields fall
/// back to the defaults when deserialized, so older config files keep
/// working.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
  pub theme: String,
  pub currency: String,
  pub date_format: String,
  /// UI language ("en", "de", "nl", "fr"); "en" is the fallback.
  pub language: String,
}

impl Default for AppConfig {
  fn default() -> Self {
    Self {
      theme: "tokyonight".to_string(),
      currency: "EUR".to_string(),
      date_format: "DD/MM/YYYY".to_string(),
      language: "en".to_string(),
    }
  }
}

fn resolve_paths() -> AppPaths {
  let data_root = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
  let config_root = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
  let app_data = data_root.join(APP_DIR_NAME);
  AppPaths {
    db: app_data
      .join("collection.db")
      .to_string_lossy()
      .into_owned(),
    media: app_data.join("media").to_string_lossy().into_owned(),
    config: config_root
      .join(APP_DIR_NAME)
      .join("config.json")
      .to_string_lossy()
      .into_owned(),
  }
}

/// Creates the XDG data/config layout (media dir + default config file) if
/// it does not exist yet. Called on startup and exposed to the frontend.
fn ensure_app_data() -> Result<AppPaths, String> {
  let paths = resolve_paths();

  let media_dir = PathBuf::from(&paths.media);
  fs::create_dir_all(&media_dir)
    .map_err(|e| format!("failed to create media directory: {e}"))?;

  let config_file = PathBuf::from(&paths.config);
  if let Some(parent) = config_file.parent() {
    fs::create_dir_all(parent)
      .map_err(|e| format!("failed to create config directory: {e}"))?;
  }
  if !config_file.exists() {
    let default_config = serde_json::to_string_pretty(&AppConfig::default())
      .map_err(|e| format!("failed to serialize default config: {e}"))?;
    fs::write(&config_file, default_config)
      .map_err(|e| format!("failed to write config file: {e}"))?;
  }

  Ok(paths)
}

/// Initialize (idempotent) the application data layout and return the
/// resolved XDG paths.
#[tauri::command]
fn init_app_data() -> Result<AppPaths, String> {
  ensure_app_data()
}

/// Copy a user-picked file into the media directory. If the target name is
/// already taken, a unix-timestamp suffix is inserted before the extension.
/// Returns the path relative to the media directory.
#[tauri::command]
fn media_copy_file(src: String) -> Result<String, String> {
  let paths = resolve_paths();
  let media_dir = PathBuf::from(&paths.media);
  fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

  let src_path = Path::new(&src);
  if !src_path.is_file() {
    return Err(format!("source file not found: {src}"));
  }
  let file_name = src_path
    .file_name()
    .and_then(|n| n.to_str())
    .ok_or_else(|| format!("invalid source file name: {src}"))?;

  let mut dest = media_dir.join(file_name);
  if dest.exists() {
    let ts = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0);
    let stem = src_path
      .file_stem()
      .and_then(|s| s.to_str())
      .unwrap_or("file");
    let ext = src_path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let name = if ext.is_empty() {
      format!("{stem}-{ts}")
    } else {
      format!("{stem}-{ts}.{ext}")
    };
    dest = media_dir.join(name);
  }

  fs::copy(src_path, &dest).map_err(|e| e.to_string())?;

  dest.strip_prefix(&media_dir)
    .map_err(|e| e.to_string())?
    .to_str()
    .ok_or_else(|| "copied path is not valid UTF-8".to_string())
    .map(|s| s.to_string())
}

/**
 * Read a user-selected text file (e.g. a FiiO DSP XML export) and return its
 * contents. Capped at 1 MiB; must be valid UTF-8.
 */
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  let p = Path::new(&path);
  if !p.is_file() {
    return Err(format!("file not found: {path}"));
  }
  let meta = p.metadata().map_err(|e| e.to_string())?;
  if meta.len() > 1_048_576 {
    return Err(note("err.file_too_large"));
  }
  let bytes = fs::read(p).map_err(|e| e.to_string())?;
  String::from_utf8(bytes)
    .map_err(|_| "file is not valid UTF-8 text".to_string())
}

/// Delete a media file addressed by its path relative to the media dir.
/// Silently ignores missing files so deletes stay idempotent.
#[tauri::command]
fn media_delete(rel_path: String) -> Result<(), String> {
  remove_media_file(&rel_path);
  Ok(())
}

fn remove_media_file(rel_path: &str) {
  let paths = resolve_paths();
  let media_dir = PathBuf::from(&paths.media);
  let full = media_dir.join(rel_path);

  // Only ever touch files inside the media directory.
  let Ok(canon) = full.canonicalize() else {
    return; // file already gone
  };
  let Ok(canon_dir) = media_dir.canonicalize() else {
    return;
  };
  if canon.starts_with(&canon_dir) {
    let _ = fs::remove_file(&canon);
  }
}

/// Read a media file and return it as a base64 data URL. Used by the UI as
/// a fallback for image display when the asset protocol cannot be used.
#[tauri::command]
fn media_read_base64(rel_path: String) -> Result<String, String> {
  let paths = resolve_paths();
  let media_dir = PathBuf::from(&paths.media);
  let full = media_dir.join(&rel_path);

  let canon = full.canonicalize().map_err(|e| e.to_string())?;
  let canon_dir = media_dir.canonicalize().map_err(|e| e.to_string())?;
  if !canon.starts_with(&canon_dir) {
    return Err(note("err.path_escapes_media"));
  }

  let bytes = fs::read(&canon).map_err(|e| e.to_string())?;
  let ext = canon
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();
  let mime = match ext.as_str() {
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "webp" => "image/webp",
    "gif" => "image/gif",
    "svg" => "image/svg+xml",
    "bmp" => "image/bmp",
    other => return Err(format!("unsupported image type: {other}")),
  };

  let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
  Ok(format!("data:{mime};base64,{encoded}"))
}

/// Open the media folder in the system file manager.
#[tauri::command]
fn open_media_folder() -> Result<(), String> {
  let paths = resolve_paths();
  fs::create_dir_all(&paths.media).map_err(|e| e.to_string())?;
  tauri_plugin_opener::open_path(&paths.media, None::<&str>).map_err(|e| e.to_string())
}

/// Keep a conservative file-name subset; other characters become dashes.
fn sanitize_file_name(name: &str) -> String {
  let cleaned: String = name
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric()
        || c == ' '
        || c == '-'
        || c == '.'
        || c == '('
        || c == ')'
        || c == '&'
        || c == '+'
      {
        c
      } else {
        '-'
      }
    })
    .collect();
  let collapsed: String = cleaned
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");
  let trimmed = collapsed.trim().to_string();
  if trimmed.is_empty() {
    "file".to_string()
  } else {
    trimmed.chars().take(150).collect()
  }
}

/// Write raw bytes into the media directory (collision-safe). Returns the
/// path relative to the media directory.
fn save_media_bytes(name: &str, data: &[u8]) -> Result<String, String> {
  let paths = resolve_paths();
  let media_dir = PathBuf::from(&paths.media);
  fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

  let file_name = sanitize_file_name(name);
  let mut dest = media_dir.join(&file_name);
  if dest.exists() {
    let ts = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0);
    let dot = file_name.rfind('.').filter(|p| *p > 0);
    let (stem, ext) = match dot {
      Some(p) => (file_name[..p].to_string(), file_name[p..].to_string()),
      None => (file_name.clone(), String::new()),
    };
    dest = media_dir.join(format!("{stem}-{ts}{ext}"));
  }

  fs::write(&dest, data).map_err(|e| e.to_string())?;

  dest.strip_prefix(&media_dir)
    .map_err(|e| e.to_string())?
    .to_str()
    .ok_or_else(|| "saved path is not valid UTF-8".to_string())
    .map(|s| s.to_string())
}

/// Save raw bytes (e.g. a rendered frequency-response PNG) into the media
/// directory. Returns the path relative to the media directory.
#[tauri::command]
fn media_save_bytes(name: String, data: Vec<u8>) -> Result<String, String> {
  save_media_bytes(&name, &data)
}

/// Download a remote image into the media directory (https only, 5 MB cap,
/// image content type required). Returns the relative media path.
#[tauri::command]
async fn media_download_image(url: String, name: String) -> Result<String, String> {
  let url = url.trim().to_string();
  if !url.starts_with("https://") {
    return Err(note("err.https_only"));
  }

  let client = reqwest::Client::builder()
    .user_agent(fetch_specs::USER_AGENT)
    .timeout(std::time::Duration::from_secs(20))
    .build()
    .map_err(|e| e.to_string())?;

  let resp = client
    .get(&url)
    .send()
    .await
    .map_err(|e| format!("download failed: {e}"))?;
  if !resp.status().is_success() {
    return Err(format!("download failed (HTTP {})", resp.status()));
  }
  let content_type = resp
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .split(';')
    .next()
    .unwrap_or("")
    .trim()
    .to_lowercase();
  if !content_type.starts_with("image/") {
    return Err(format!("not an image (content type: {content_type})"));
  }
  let bytes = resp
    .bytes()
    .await
    .map_err(|e| format!("download failed: {e}"))?;
  if bytes.len() > fetch_specs::MAX_IMAGE_BYTES {
    return Err(note("err.image_too_large"));
  }

  let ext: String = match content_type.as_str() {
    "image/png" => "png".to_string(),
    "image/jpeg" => "jpg".to_string(),
    "image/webp" => "webp".to_string(),
    "image/gif" => "gif".to_string(),
    "image/svg+xml" => "svg".to_string(),
    "image/bmp" => "bmp".to_string(),
    _ => {
      // Unknown image/* type — infer from the URL path if possible.
      url.split('?')
        .next()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .and_then(|n| n.split_once('.').map(|(_, e)| e.to_lowercase()))
        .filter(|e| ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"].contains(&e.as_str()))
        .unwrap_or_else(|| "bin".to_string())
    }
  };

  let base_name = if name.trim().is_empty() {
    // Derive from the URL file name.
    url.split('?').next().unwrap_or("")
      .rsplit('/')
      .next()
      .unwrap_or("image")
      .split_once('.')
      .map(|(s, _)| s)
      .unwrap_or("image")
      .to_string()
  } else {
    name.trim().to_string()
  };
  let full_name = if base_name.to_lowercase().ends_with(&format!(".{ext}")) {
    base_name
  } else {
    format!("{base_name}.{ext}")
  };

  save_media_bytes(full_name.as_str(), &bytes)
}

/// Read the application config. A missing file (or missing fields) falls
/// back to the defaults.
#[tauri::command]
fn read_config() -> Result<AppConfig, String> {
  let paths = resolve_paths();
  let raw =
    fs::read_to_string(&paths.config).unwrap_or_else(|_| "{}".to_string());
  serde_json::from_str(&raw).map_err(|e| format!("invalid config file: {e}"))
}

/// Persist the application config as pretty-printed JSON.
#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
  let paths = resolve_paths();
  let config_file = Path::new(&paths.config);
  if let Some(parent) = config_file.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
  fs::write(config_file, raw).map_err(|e| e.to_string())
}

/// Run the best-effort web auto-fetch for a brand/model combination.
/// See the `fetch_specs` module: problems are reported as notes in the
/// result, never as command errors.
#[tauri::command]
async fn fetch_specs(
  brand: String,
  model: String,
  device_type: String,
) -> Result<fetch_specs::FetchedSpecs, String> {
  Ok(fetch_specs::fetch_specs(&brand, &model, &device_type).await)
}

/// Run the best-effort OPRA preset lookup for a brand/model combination.
/// See the `fetch_opra` module: problems are reported as a `note` in the
/// result, never as command errors — the form falls back to file import.
#[tauri::command]
async fn fetch_opra_presets(
  brand: String,
  model: String,
) -> fetch_opra::OpraFetchResult {
  fetch_opra::fetch_opra_presets(&brand, &model).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // WebKitGTK's dmabuf GPU renderer triggers a Wayland protocol error on
  // KWin — the compositor kills the client ~500ms after window creation,
  // which looks like the app window closing instantly. Disabling the
  // renderer falls back to the classic GL/shm path. An explicit user value
  // is respected; this only provides a default.
  // Safety: called once at the very start of startup, before any other
  // thread exists, so no concurrent env access can race with this write.
  if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
  }

  // First-launch behavior: create the XDG layout + DB parent dir before the
  // frontend loads the database.
  let paths =
    ensure_app_data().expect("failed to initialize audio-vault data directories");
  // The SQL plugin keys its migrations by the exact URL string the frontend
  // passes to `Database.load`, so both sides must use the same absolute path.
  let db_url = format!("sqlite:{}", paths.db);

  let migrations = vec![Migration {
    version: 1,
    description: "create_devices_table",
    sql: "CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        type TEXT NOT NULL,
        image_path TEXT,
        price REAL,
        purchase_date TEXT,
        driver_type TEXT,
        impedance_ohms INTEGER,
        sensitivity_db REAL,
        connector_type TEXT,
        tube_amp_suitable TEXT,
        drive_difficulty TEXT,
        sound_signature TEXT,
        soundstage_rating INTEGER,
        listening_notes TEXT,
        fr_graph_path TEXT,
        peq_settings TEXT,
        custom_fields TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 2,
    description: "add_color_column",
    sql: "ALTER TABLE devices ADD COLUMN color TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 3,
    description: "add_manufacturer_url_column",
    sql: "ALTER TABLE devices ADD COLUMN manufacturer_url TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 4,
    description: "add_webshop_url_column",
    sql: "ALTER TABLE devices ADD COLUMN webshop_url TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 5,
    description: "add_peq_source_column",
    sql: "ALTER TABLE devices ADD COLUMN peq_source TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 6,
    description: "migrate_dual_35mm_connector_to_single",
    sql: "UPDATE devices SET connector_type = 'Single 3.5mm' WHERE connector_type = 'Dual 3.5mm';",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 7,
    description: "rename_connector_options_jack_pentaconn",
    sql: "UPDATE devices SET connector_type = CASE connector_type
        WHEN 'Single 3.5mm' THEN '3.5mm jack'
        WHEN 'Dual 3.5mm' THEN '3.5mm jack'
        WHEN '2.5mm' THEN '2.5mm jack'
        WHEN '4.4mm' THEN '4.4mm Pentaconn'
        WHEN '4-pin Pentaconn' THEN '4.4mm Pentaconn'
        WHEN '6.35mm' THEN '6.35mm jack'
        ELSE connector_type
    END;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 8,
    description: "add_mood_image_path_column",
    sql: "ALTER TABLE devices ADD COLUMN mood_image_path TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 9,
    description: "add_overall_rating_column",
    // Stores 2x the user rating so half stars fit in an INTEGER column:
    // 1..=10 maps to 0.5..=5.0; NULL means unrated.
    sql: "ALTER TABLE devices ADD COLUMN overall_rating INTEGER;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 10,
    description: "add_imaging_rating_column",
    sql: "ALTER TABLE devices ADD COLUMN imaging_rating INTEGER;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 11,
    description: "add_detail_retrieval_rating_column",
    sql: "ALTER TABLE devices ADD COLUMN detail_retrieval_rating INTEGER;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 12,
    description: "add_timbre_rating_column",
    sql: "ALTER TABLE devices ADD COLUMN timbre_rating INTEGER;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 13,
    description: "add_tonal_balance_rating_column",
    sql: "ALTER TABLE devices ADD COLUMN tonal_balance_rating INTEGER;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 14,
    description: "double_sound_ratings_for_half_steps",
    // Sound ratings now use the same 2x storage convention as
    // overall_rating so half dots fit in INTEGER columns (1..=10 maps to
    // 0.5..=5.0). Existing whole-number ratings are doubled in place;
    // NULL * 2 stays NULL.
    sql: "UPDATE devices SET soundstage_rating = soundstage_rating * 2, imaging_rating = imaging_rating * 2, detail_retrieval_rating = detail_retrieval_rating * 2, timbre_rating = timbre_rating * 2, tonal_balance_rating = tonal_balance_rating * 2;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 15,
    description: "add_updated_at_column",
    // Nullable on purpose (SQLite forbids non-constant defaults on
    // ADD COLUMN): pre-v15 rows keep NULL and the frontend falls back
    // to created_at for them. saveDevice stamps it on every insert and
    // update from then on.
    sql: "ALTER TABLE devices ADD COLUMN updated_at TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 16,
    description: "add_devices_category_columns",
    // Second top-level category ("devices": DAC, AMP, dongle, AVR, ...).
    // `category` gets a constant default so pre-existing rows become
    // 'headphones' automatically; the rest are device-category-only
    // specs (NULL for headphones). inputs/outputs/bluetooth_codecs are
    // JSON string arrays, same convention as custom_fields.
    // Multi-statement migrations are fine: the plugin runs them through
    // sqlx's migrator, which executes the whole script in one transaction.
    sql: "ALTER TABLE devices ADD COLUMN category TEXT NOT NULL DEFAULT 'headphones';
          ALTER TABLE devices ADD COLUMN device_type TEXT;
          ALTER TABLE devices ADD COLUMN dac_chip TEXT;
          ALTER TABLE devices ADD COLUMN supported_formats TEXT;
          ALTER TABLE devices ADD COLUMN bluetooth_codecs TEXT;
          ALTER TABLE devices ADD COLUMN inputs TEXT;
          ALTER TABLE devices ADD COLUMN outputs TEXT;
          ALTER TABLE devices ADD COLUMN output_power TEXT;
          ALTER TABLE devices ADD COLUMN snr_db REAL;
          ALTER TABLE devices ADD COLUMN thd_n TEXT;
          ALTER TABLE devices ADD COLUMN load_min_ohms INTEGER;
          ALTER TABLE devices ADD COLUMN load_max_ohms INTEGER;
          ALTER TABLE devices ADD COLUMN channels TEXT;
          ALTER TABLE devices ADD COLUMN hdmi TEXT;
          ALTER TABLE devices ADD COLUMN room_correction TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 18,
    description: "add_device_images_column",
    // Devices-category gallery: JSON string array of relative media
    // paths (same convention as inputs/outputs). The first entry is the
    // cover shown in collection cards and the detail hero. Headphones
    // keep using image_path / mood_image_path and leave this empty.
    sql: "ALTER TABLE devices ADD COLUMN images TEXT;",
    kind: MigrationKind::Up,
  },
  Migration {
    version: 17,
    description: "make_type_nullable_for_devices_category",
    // Devices-category rows have no headphone type, so `type` must be
    // nullable. SQLite cannot relax a column constraint in place, so the
    // table is rebuilt (create / copy / drop / rename) inside the
    // migration's transaction. Column list generated from the live
    // schema after v16 — all 46 columns carry over unchanged.
    sql: "CREATE TABLE devices_v17 (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  type TEXT,
  image_path TEXT,
  price REAL,
  purchase_date TEXT,
  driver_type TEXT,
  impedance_ohms INTEGER,
  sensitivity_db REAL,
  connector_type TEXT,
  tube_amp_suitable TEXT,
  drive_difficulty TEXT,
  sound_signature TEXT,
  soundstage_rating INTEGER,
  listening_notes TEXT,
  fr_graph_path TEXT,
  peq_settings TEXT,
  custom_fields TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  color TEXT,
  manufacturer_url TEXT,
  webshop_url TEXT,
  peq_source TEXT,
  mood_image_path TEXT,
  overall_rating INTEGER,
  imaging_rating INTEGER,
  detail_retrieval_rating INTEGER,
  timbre_rating INTEGER,
  tonal_balance_rating INTEGER,
  updated_at TEXT,
  category TEXT NOT NULL DEFAULT 'headphones',
  device_type TEXT,
  dac_chip TEXT,
  supported_formats TEXT,
  bluetooth_codecs TEXT,
  inputs TEXT,
  outputs TEXT,
  output_power TEXT,
  snr_db REAL,
  thd_n TEXT,
  load_min_ohms INTEGER,
  load_max_ohms INTEGER,
  channels TEXT,
  hdmi TEXT,
  room_correction TEXT
);
INSERT INTO devices_v17 SELECT id, brand, model, type, image_path, price, purchase_date, driver_type, impedance_ohms, sensitivity_db, connector_type, tube_amp_suitable, drive_difficulty, sound_signature, soundstage_rating, listening_notes, fr_graph_path, peq_settings, custom_fields, created_at, color, manufacturer_url, webshop_url, peq_source, mood_image_path, overall_rating, imaging_rating, detail_retrieval_rating, timbre_rating, tonal_balance_rating, updated_at, category, device_type, dac_chip, supported_formats, bluetooth_codecs, inputs, outputs, output_power, snr_db, thd_n, load_min_ohms, load_max_ohms, channels, hdmi, room_correction FROM devices;
DROP TABLE devices;
ALTER TABLE devices_v17 RENAME TO devices;",
    kind: MigrationKind::Up,
  }];

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(&db_url, migrations)
        .build(),
    )
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      init_app_data,
      media_copy_file,
      media_delete,
      media_read_base64,
      media_save_bytes,
      media_download_image,
      open_media_folder,
      read_text_file,
      read_config,
      save_config,
      fetch_specs,
      fetch_opra_presets
    ])
    // rust-analyzer cannot fully expand tauri::generate_context!() in its sandbox
    // (the generated context's asset/CSP fields come out as {unknown}), so it
    // reports E0308 here. rustc is clean (cargo check/test pass) — the ignore
    // below keeps pi-lens quiet about this analyzer limitation.
    // pi-lens-ignore: rust-analyzer:E0308
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
