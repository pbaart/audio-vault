//! Backup & restore: pack the collection database and the media directory
//! into a single zip archive, and restore from such an archive.
//!
//! Archive layout (paths relative to the archive root):
//! ```text
//! manifest.json   { "app": "audio-vault", "version": "X.Y.Z", "created_at": "…" }
//! collection.db   SQLite database (SQLite online backup — consistent even
//!                 while the app holds the file open)
//! media/…         everything under the media directory EXCEPT `.cache/`
//!                 (the scaled-image cache is regenerable)
//! ```
//!
//! Restore validates the archive completely BEFORE touching anything, keeps
//! an automatic safety copy of the current state, then swaps in database and
//! media. The app must be restarted afterwards: the SQL plugin's connection
//! pool still holds the old database file open, and already-loaded images
//! stay in memory until then.

use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::{note, note_with};

/// Database file name inside the archive.
const DB_NAME: &str = "collection.db";
const MANIFEST_NAME: &str = "manifest.json";
const MEDIA_DIR_NAME: &str = "media";
/// Identifies this app's archives in the manifest.
const APP_ID: &str = "audio-vault";
/// Regenerable scaled-image cache — never backed up.
const MEDIA_CACHE_DIR: &str = ".cache";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
  /// Size of the finished archive in bytes.
  pub size_bytes: u64,
  /// Number of media files stored in the archive.
  pub media_files: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
  /// Where the pre-restore state was archived automatically; empty when
  /// there was nothing to protect (fresh install, empty collection).
  pub safety_copy_path: String,
  /// Number of media files written by the restore.
  pub media_files: usize,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
  app: String,
  version: String,
  /// Optional in the file (older/foreign archives may omit it).
  #[serde(default)]
  #[allow(dead_code)]
  created_at: String,
}

/// Parse "X.Y.Z" (an optional leading `v` is tolerated) into a comparable
/// triple. Missing minor/patch count as 0; anything unparsable is `None`
/// (treated as "unknown" by callers, which only block on PROVEN-newer).
fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
  let mut parts = v.trim().trim_start_matches('v').split('.');
  let major: u64 = parts.next()?.parse().ok()?;
  let minor: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
  let patch: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
  Some((major, minor, patch))
}

/// UTC timestamp `YYYY-MM-DDTHH:MM:SSZ` without a chrono dependency.
fn utc_stamp(secs: u64) -> String {
  let days = (secs / 86_400) as i64;
  let rem = secs % 86_400;
  let (y, mo, d) = civil_from_days(days);
  format!(
    "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z",
    rem / 3600,
    (rem % 3600) / 60,
    rem % 60
  )
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

/// Days-since-1970-01-01 → (year, month, day). Howard Hinnant's
/// `civil_from_days` algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
  let z = z + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let doe = (z - era * 146_097) as u64; // [0, 146096]
  let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
  let y = yoe as i64 + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
  let mp = (5 * doy + 2) / 153; // [0, 11]
  let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
  let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
  (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Create a backup archive at `dest` from the live database + media dir.
/// The database is copied with SQLite's online backup API, so the snapshot
/// is consistent even while the app holds the file open. `dest` is written
/// atomically (`.part` file renamed into place).
pub fn create_backup(
  db_path: &Path,
  media_dir: &Path,
  dest: &Path,
) -> Result<BackupSummary, String> {
  if let Some(parent) = dest.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let part = dest.with_extension("zip.part");

  // 1. Online-backup the live DB into a scratch file next to the archive.
  let db_scratch = dest.with_extension("zip.db");
  let has_db = db_path.is_file();
  if has_db {
    let src = Connection::open_with_flags(
      db_path,
      OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("failed to open database for backup: {e}"))?;
    // SQLite online backup into a fresh file — consistent even while the
    // app holds the database open.
    src.backup(DatabaseName::Main, &db_scratch, None)
      .map_err(|e| format!("database backup failed: {e}"))?;
  } else {
    fs::remove_file(&db_scratch).ok();
  }

  // 2. Zip manifest + database + media.
  let out = fs::File::create(&part).map_err(|e| e.to_string())?;
  let mut zw = ZipWriter::new(out);
  let options = SimpleFileOptions::default()
    .compression_method(CompressionMethod::Deflated);

  let manifest = serde_json::json!({
    "app": APP_ID,
    "version": env!("CARGO_PKG_VERSION"),
    "created_at": utc_stamp(now_secs()),
  });
  zw.start_file(MANIFEST_NAME, options.clone())
    .map_err(|e| e.to_string())?;
  zw.write_all(manifest.to_string().as_bytes())
    .map_err(|e| e.to_string())?;

  if has_db {
    zw.start_file(DB_NAME, options.clone())
      .map_err(|e| e.to_string())?;
    let bytes = fs::read(&db_scratch).map_err(|e| e.to_string())?;
    zw.write_all(&bytes).map_err(|e| e.to_string())?;
  }

  let mut media_files = 0usize;
  if media_dir.is_dir() {
    add_media_to_zip(media_dir, media_dir, &mut zw, options, &mut media_files)
      .map_err(|e| {
        fs::remove_file(&db_scratch).ok();
        fs::remove_file(&part).ok();
        e
      })?;
  }
  zw.finish().map_err(|e| {
    fs::remove_file(&db_scratch).ok();
    fs::remove_file(&part).ok();
    e.to_string()
  })?;
  fs::remove_file(&db_scratch).ok();

  // 3. Atomically move into place.
  fs::rename(&part, dest).map_err(|e| {
    fs::remove_file(&part).ok();
    e.to_string()
  })?;
  let size_bytes = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
  Ok(BackupSummary {
    size_bytes,
    media_files,
  })
}

/// Recursively add `dir` (under `root`) to the zip as `media/<rel>`,
/// skipping the regenerable `.cache` directory.
fn add_media_to_zip(
  root: &Path,
  dir: &Path,
  zw: &mut ZipWriter<fs::File>,
  options: SimpleFileOptions,
  count: &mut usize,
) -> Result<(), String> {
  let mut entries: Vec<PathBuf> = fs::read_dir(dir)
    .map_err(|e| e.to_string())?
    .flatten()
    .map(|e| e.path())
    .collect();
  entries.sort();
  for p in entries {
    if p.is_dir() {
      let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(MEDIA_CACHE_DIR);
      if name == MEDIA_CACHE_DIR {
        continue;
      }
      add_media_to_zip(root, &p, zw, options.clone(), count)?;
    } else {
      let rel = p.strip_prefix(root).map_err(|e| e.to_string())?;
      let entry_name =
        format!("{MEDIA_DIR_NAME}/{}", rel.to_string_lossy());
      zw.start_file(entry_name, options.clone())
        .map_err(|e| e.to_string())?;
      let bytes = fs::read(&p).map_err(|e| e.to_string())?;
      zw.write_all(&bytes).map_err(|e| e.to_string())?;
      *count += 1;
    }
  }
  Ok(())
}

/// Restore the collection from a backup archive.
///
/// Order of operations: validate everything (archive integrity, manifest,
/// version guard, database integrity) → automatic safety copy of the current
/// state → swap database → replace media. Nothing is modified before the
/// validation phase completes.
pub fn restore_backup(
  db_path: &Path,
  media_dir: &Path,
  src_zip: &Path,
  current_version: &str,
  latest_migration_version: i64,
) -> Result<RestoreResult, String> {
  if !src_zip.is_file() {
    return Err(format!("backup file not found: {}", src_zip.display()));
  }
  let data_root = db_path.parent().unwrap_or_else(|| Path::new("."));
  fs::create_dir_all(data_root).map_err(|e| e.to_string())?;

  // Stage under the data root (same filesystem as the DB → atomic rename).
  let staging = data_root.join(format!(".restore-staging-{}", now_secs()));
  fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

  // 1. Extract every entry, refusing unsafe paths (zip-slip).
  let file = fs::File::open(src_zip).map_err(|e| e.to_string())?;
  let mut za = match ZipArchive::new(file) {
    Ok(za) => za,
    Err(_) => {
      fs::remove_dir_all(&staging).ok();
      return Err(note("err.backup_not_a_zip"));
    }
  };
  let mut have_manifest = false;
  let mut have_db = false;
  for i in 0..za.len() {
    let mut entry = za.by_index(i).map_err(|e| e.to_string())?;
    let Some(rel) = entry.enclosed_name() else {
      fs::remove_dir_all(&staging).ok();
      return Err(note("err.backup_bad_entry"));
    };
    let full = staging.join(&rel);
    if entry.is_dir() {
      fs::create_dir_all(&full).map_err(|e| e.to_string())?;
    } else {
      if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
      let mut buf = Vec::new();
      entry
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
      fs::write(&full, &buf).map_err(|e| e.to_string())?;
    }
    let name = rel.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let top = rel.components().count() == 1;
    if top && name == MANIFEST_NAME {
      have_manifest = true;
    }
    if top && name == DB_NAME {
      have_db = true;
    }
  }
  drop(za);
  if !have_manifest {
    fs::remove_dir_all(&staging).ok();
    return Err(note("err.backup_missing_manifest"));
  }
  if !have_db {
    fs::remove_dir_all(&staging).ok();
    return Err(note("err.backup_missing_db"));
  }

  // 2. Manifest: right app, not provably newer than this build.
  let manifest_raw = fs::read_to_string(staging.join(MANIFEST_NAME))
    .map_err(|e| e.to_string())?;
  let manifest: Manifest = serde_json::from_str(&manifest_raw)
    .map_err(|_| note("err.backup_bad_manifest"))?;
  if manifest.app != APP_ID {
    fs::remove_dir_all(&staging).ok();
    return Err(note("err.backup_wrong_app"));
  }
  if let (Some(bv), Some(cv)) =
    (parse_version(&manifest.version), parse_version(current_version))
  {
    if bv > cv {
      fs::remove_dir_all(&staging).ok();
      return Err(note_with(
        "err.backup_newer_version",
        serde_json::json!([manifest.version]),
      ));
    }
  }

  // 3. Database: readable, intact, has the devices table, and its schema is
  //    not ahead of this build's migrations (second line of defence against
  //    a tampered manifest).
  let staged_db = staging.join(DB_NAME);
  {
    let conn =
      Connection::open(&staged_db).map_err(|_| note("err.backup_db_invalid"))?;
    let result: String = conn
      .query_row("PRAGMA integrity_check;", [], |r| r.get(0))
      .map_err(|_| note("err.backup_db_invalid"))?;
    if result != "ok" {
      fs::remove_dir_all(&staging).ok();
      return Err(note("err.backup_db_invalid"));
    }
    let has_devices: bool = conn
      .query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master \
         WHERE type = 'table' AND name = 'devices')",
        [],
        |r| r.get(0),
      )
      .map_err(|_| note("err.backup_no_devices_table"))?;
    if !has_devices {
      fs::remove_dir_all(&staging).ok();
      return Err(note("err.backup_no_devices_table"));
    }
    let max_mig: i64 = conn
      .query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
        [],
        |r| r.get(0),
      )
      .unwrap_or(0);
    if max_mig > latest_migration_version {
      fs::remove_dir_all(&staging).ok();
      return Err(note_with(
        "err.backup_newer_version",
        serde_json::json!([manifest.version]),
      ));
    }
  }

  // 4. Automatic safety copy of the current state (when there is one).
  let has_current_db = db_path.is_file();
  let has_current_media = media_dir
    .is_dir()
    && fs::read_dir(media_dir).map(|mut d| d.next().is_some()).unwrap_or(false);
  let mut safety_copy_path = String::new();
  if has_current_db || has_current_media {
    let stamp = utc_stamp(now_secs()).replace('-', "").replace(':', "");
    let safety = data_root
      .join(format!("audio-vault-pre-restore-{stamp}.zip"));
    create_backup(db_path, media_dir, &safety).map_err(|e| {
      fs::remove_dir_all(&staging).ok();
      format!("failed to create the pre-restore safety copy: {e}")
    })?;
    safety_copy_path = safety.to_string_lossy().into_owned();
  }

  // 5. Swap the database. Remove the old file's WAL sidecars first: they
  //    belong to the OLD inode, and if left behind SQLite would apply them
  //    to the NEW database on the next open.
  if let Some(file_name) = db_path.file_name().and_then(|n| n.to_str()) {
    for suffix in ["-wal", "-shm"] {
      let sidecar = data_root.join(format!("{file_name}{suffix}"));
      fs::remove_file(sidecar).ok();
    }
  }
  fs::rename(&staged_db, db_path)
    .or_else(|_| {
      // Same-filesystem rename above; fall back to copy for exotic layouts.
      fs::copy(&staged_db, db_path).and_then(|_| fs::remove_file(&staged_db))
    })
    .map_err(|e| format!("failed to install the restored database: {e}"))?;

  // 6. Replace the media directory wholesale (including the cache, which is
  //    regenerated on demand).
  if media_dir.is_dir() {
    fs::remove_dir_all(media_dir).map_err(|e| e.to_string())?;
  }
  let staged_media = staging.join(MEDIA_DIR_NAME);
  let mut media_files = 0usize;
  if staged_media.is_dir() {
    copy_tree(&staged_media, media_dir, &mut media_files)
      .map_err(|e| format!("failed to restore media files: {e}"))?;
  } else {
    fs::create_dir_all(media_dir).map_err(|e| e.to_string())?;
  }

  fs::remove_dir_all(&staging).ok();
  Ok(RestoreResult {
    safety_copy_path,
    media_files,
  })
}

/// Recursively copy `src` into `dst`, creating directories as needed.
fn copy_tree(src: &Path, dst: &Path, count: &mut usize) -> Result<(), String> {
  fs::create_dir_all(dst).map_err(|e| e.to_string())?;
  let mut entries: Vec<PathBuf> = fs::read_dir(src)
    .map_err(|e| e.to_string())?
    .flatten()
    .map(|e| e.path())
    .collect();
  entries.sort();
  for p in entries {
    let target = dst.join(
      p.file_name().ok_or_else(|| "bad path entry".to_string())?,
    );
    if p.is_dir() {
      copy_tree(&p, &target, count)?;
    } else {
      fs::copy(&p, &target).map_err(|e| e.to_string())?;
      *count += 1;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::params;

  fn tmp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
      "audio-vault-test-{tag}-{}",
      std::process::id()
    ));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
  }

  /// Fake data layout: a migrated database with `rows` devices plus media
  /// files (including a `.cache` entry that must never be backed up).
  fn make_layout<const N: usize>(
    root: &Path,
    rows: [&str; N],
    max_migration: i64,
  ) -> (PathBuf, PathBuf) {
    fs::create_dir_all(root).unwrap();
    let db = root.join("collection.db");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
      "CREATE TABLE _sqlx_migrations (
         version INTEGER PRIMARY KEY, description TEXT NOT NULL,
         installed_on TEXT NOT NULL, success BOOLEAN NOT NULL,
         checksum BLOB NOT NULL, execution_time INTEGER NOT NULL);
       CREATE TABLE devices (
         id TEXT PRIMARY KEY, brand TEXT NOT NULL,
         model TEXT NOT NULL, type TEXT);",
    )
    .unwrap();
    for (i, brand) in rows.iter().enumerate() {
      conn.execute(
        "INSERT INTO devices (id, brand, model, type) VALUES (?1, ?2, 'M', 'Open-back')",
        params![format!("id-{i}"), brand],
      )
      .unwrap();
    }
    conn.execute(
      "INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
       VALUES (?1, 'x', 'now', 1, X'00', 0)",
      params![max_migration],
    )
    .unwrap();

    let media = root.join("media");
    fs::create_dir_all(media.join("sub")).unwrap();
    fs::create_dir_all(media.join(".cache")).unwrap();
    fs::write(media.join("a.jpg"), b"img-a").unwrap();
    fs::write(media.join("sub").join("b.png"), b"img-b").unwrap();
    fs::write(media.join(".cache").join("640x_a.jpg"), b"cached")
      .unwrap();
    (db, media)
  }

  fn db_brands(db: &Path) -> Vec<String> {
    let conn = Connection::open(db).unwrap();
    let mut stmt =
      conn.prepare("SELECT brand FROM devices ORDER BY brand").unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
      .unwrap()
      .collect::<Result<Vec<_>, _>>()
      .unwrap()
  }

  #[test]
  fn version_parsing() {
    assert_eq!(parse_version("0.5.1"), Some((0, 5, 1)));
    assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
    assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
    assert_eq!(parse_version("garbage"), None);
    assert!(parse_version("99.0.0").unwrap() > parse_version("0.5.1").unwrap());
    assert!(parse_version("0.5.1").unwrap() <= parse_version("0.5.1").unwrap());
  }

  #[test]
  fn stamp_is_sane() {
    assert_eq!(utc_stamp(0), "1970-01-01T00:00:00Z");
    assert_eq!(utc_stamp(86_400), "1970-01-02T00:00:00Z");
    assert_eq!(utc_stamp(1_700_000_000), "2023-11-14T22:13:20Z");
  }

  #[test]
  fn backup_roundtrip_restores_state() {
    let live = tmp_dir("rt-live");
    let (db, media) = make_layout(&live, ["Alpha", "Beta"], 21);
    let archive = live.join("backup.zip");

    let summary = create_backup(&db, &media, &archive).unwrap();
    assert!(summary.size_bytes > 0);
    assert_eq!(summary.media_files, 2, ".cache must be excluded");

    // Archive contents: manifest + db + media, no cache.
    let mut za =
      ZipArchive::new(fs::File::open(&archive).unwrap()).unwrap();
    let names: Vec<String> = (0..za.len())
      .map(|i| za.by_index(i).unwrap().name().to_string())
      .collect();
    assert!(names.contains(&MANIFEST_NAME.to_string()));
    assert!(names.contains(&DB_NAME.to_string()));
    assert!(names.contains(&"media/a.jpg".to_string()));
    assert!(names.contains(&"media/sub/b.png".to_string()));
    assert!(!names.iter().any(|n| n.contains(".cache")));

    // Wipe the live state, then restore from the archive.
    fs::remove_file(&db).unwrap();
    fs::remove_dir_all(&media).unwrap();
    let result =
      restore_backup(&db, &media, &archive, "0.5.1", 21).unwrap();
    assert_eq!(result.media_files, 2);
    assert!(result.safety_copy_path.is_empty(), "nothing to protect");
    assert_eq!(db_brands(&db), vec!["Alpha", "Beta"]);
    assert_eq!(fs::read(media.join("a.jpg")).unwrap(), b"img-a");
    assert_eq!(fs::read(media.join("sub").join("b.png")).unwrap(), b"img-b");
    assert!(!media.join(".cache").exists());

    // Restore again over a LIVE state: safety copy must appear.
    fs::write(media.join("c.webp"), b"img-c").unwrap();
    let result2 =
      restore_backup(&db, &media, &archive, "0.5.1", 21).unwrap();
    assert!(!result2.safety_copy_path.is_empty());
    assert!(Path::new(&result2.safety_copy_path).is_file());
    assert_eq!(db_brands(&db), vec!["Alpha", "Beta"]);
    assert!(!media.join("c.webp").exists(), "media replaced wholesale");

    let _ = fs::remove_dir_all(&live);
  }

  #[test]
  fn restore_rejects_garbage_file() {
    let live = tmp_dir("garbage");
    let (db, media) = make_layout(&live, ["Alpha"], 21);
    let bad = live.join("bad.zip");
    fs::write(&bad, b"this is not a zip file at all").unwrap();
    let err = restore_backup(&db, &media, &bad, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_not_a_zip"), "{err}");
    // Live state untouched.
    assert_eq!(db_brands(&db), vec!["Alpha"]);
    let _ = fs::remove_dir_all(&live);
  }

  #[test]
  fn restore_rejects_missing_parts() {
    let live = tmp_dir("missing");
    let (db, media) = make_layout(&live, ["Alpha"], 21);

    // Zip without manifest.json
    let no_manifest = live.join("no-manifest.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&no_manifest).unwrap());
      zw.start_file(DB_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(b"x").unwrap();
      zw.finish().unwrap();
    }
    let err =
      restore_backup(&db, &media, &no_manifest, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_missing_manifest"), "{err}");

    // Zip without collection.db
    let no_db = live.join("no-db.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&no_db).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(
        br#"{"app":"audio-vault","version":"0.5.1","created_at":"x"}"#,
      )
      .unwrap();
      zw.finish().unwrap();
    }
    let err = restore_backup(&db, &media, &no_db, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_missing_db"), "{err}");

    assert_eq!(db_brands(&db), vec!["Alpha"]);
    let _ = fs::remove_dir_all(&live);
  }

  #[test]
  fn restore_rejects_corrupt_or_foreign_db() {
    let live = tmp_dir("corrupt");
    let (db, media) = make_layout(&live, ["Alpha"], 21);
    let manifest =
      br#"{"app":"audio-vault","version":"0.5.1","created_at":"x"}"#;

    // Garbage database bytes
    let bad_db = live.join("bad-db.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&bad_db).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(manifest).unwrap();
      zw.start_file(DB_NAME, SimpleFileOptions::default()).unwrap();
      zw.write_all(b"definitely not sqlite").unwrap();
      zw.finish().unwrap();
    }
    let err =
      restore_backup(&db, &media, &bad_db, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_db_invalid"), "{err}");

    // Valid SQLite file without the devices table
    let foreign = live.join("foreign.db");
    Connection::open(&foreign)
      .unwrap()
      .execute_batch("CREATE TABLE other (x TEXT);")
      .unwrap();
    let foreign_zip = live.join("foreign.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&foreign_zip).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(manifest).unwrap();
      zw.start_file(DB_NAME, SimpleFileOptions::default()).unwrap();
      zw.write_all(&fs::read(&foreign).unwrap()).unwrap();
      zw.finish().unwrap();
    }
    let err =
      restore_backup(&db, &media, &foreign_zip, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_no_devices_table"), "{err}");

    // Foreign app id
    let wrong_app = live.join("wrong-app.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&wrong_app).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(br#"{"app":"other-app","version":"0.5.1"}"#)
        .unwrap();
      zw.start_file(DB_NAME, SimpleFileOptions::default()).unwrap();
      zw.write_all(&fs::read(&db).unwrap()).unwrap();
      zw.finish().unwrap();
    }
    let err =
      restore_backup(&db, &media, &wrong_app, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_wrong_app"), "{err}");

    assert_eq!(db_brands(&db), vec!["Alpha"]);
    let _ = fs::remove_dir_all(&live);
  }

  #[test]
  fn restore_blocks_newer_versions() {
    let live = tmp_dir("newver");
    let (db, media) = make_layout(&live, ["Alpha"], 21);

    // Manifest claims a newer app version
    let newer = live.join("newer.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&newer).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(
        br#"{"app":"audio-vault","version":"9.9.9","created_at":"x"}"#,
      )
      .unwrap();
      zw.start_file(DB_NAME, SimpleFileOptions::default()).unwrap();
      zw.write_all(&fs::read(&db).unwrap()).unwrap();
      zw.finish().unwrap();
    }
    let err =
      restore_backup(&db, &media, &newer, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_newer_version"), "{err}");

    // Same-version manifest but the DB schema is ahead of this build's
    // migrations (tampered-manifest defence).
    let (db2, _) = make_layout(&live.join("ahead"), ["Alpha"], 99);
    let ahead = live.join("ahead.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&ahead).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(
        br#"{"app":"audio-vault","version":"0.5.1","created_at":"x"}"#,
      )
      .unwrap();
      zw.start_file(DB_NAME, SimpleFileOptions::default()).unwrap();
      zw.write_all(&fs::read(&db2).unwrap()).unwrap();
      zw.finish().unwrap();
    }
    let err =
      restore_backup(&db, &media, &ahead, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_newer_version"), "{err}");

    // Older backups are allowed.
    let older = live.join("older.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&older).unwrap());
      zw.start_file(MANIFEST_NAME, SimpleFileOptions::default())
        .unwrap();
      zw.write_all(
        br#"{"app":"audio-vault","version":"0.4.0","created_at":"x"}"#,
      )
      .unwrap();
      zw.start_file(DB_NAME, SimpleFileOptions::default()).unwrap();
      zw.write_all(&fs::read(&db).unwrap()).unwrap();
      zw.finish().unwrap();
    }
    restore_backup(&db, &media, &older, "0.5.1", 21).unwrap();

    assert_eq!(db_brands(&db), vec!["Alpha"]);
    let _ = fs::remove_dir_all(&live);
  }

  #[test]
  fn restore_rejects_zip_slip_entries() {
    let live = tmp_dir("slip");
    let (db, media) = make_layout(&live, ["Alpha"], 21);
    let evil = live.join("evil.zip");
    {
      let mut zw =
        ZipWriter::new(fs::File::create(&evil).unwrap());
      zw.start_file("../evil.txt", SimpleFileOptions::default())
        .unwrap();
      zw.write_all(b"pwned").unwrap();
      zw.finish().unwrap();
    }
    let err = restore_backup(&db, &media, &evil, "0.5.1", 21).unwrap_err();
    assert!(err.contains("backup_bad_entry"), "{err}");
    assert!(!live.join("..").join("evil.txt").exists());
    assert_eq!(db_brands(&db), vec!["Alpha"]);
    let _ = fs::remove_dir_all(&live);
  }
}
