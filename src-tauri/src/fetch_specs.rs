//! Best-effort web auto-fetch (Phase 2).
//!
//! Data sources:
//! * squig.link measurement index (phone books) — brand/model match, price,
//!   and the raw frequency-response measurement data (REW text files).
//! * Keyless DuckDuckGo web search — manufacturer/retailer pages, from
//!   which impedance / sensitivity / driver type and the product image
//!   (og:image) are parsed with deliberately lenient heuristics.
//!
//! Everything here is best-effort and isolated: any failure produces a note
//! in the result, never an error, and unfetched fields stay `None` so the
//! form simply keeps them blank.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{note, note_with};

pub const USER_AGENT: &str = "AudioVault/0.4 (local desktop app; audiophile spec lookup)";
const REQ_TIMEOUT: Duration = Duration::from_secs(20);
const BOOK_TIMEOUT: Duration = Duration::from_secs(8);
const PAGE_CAP: usize = 400_000;
const MAX_SPEC_PAGES: usize = 3;
pub const MAX_IMAGE_BYTES: usize = 5_000_000;
const MAIN_BOOK_TTL: u64 = 24 * 3600; // seconds
const FED_TTL: u64 = 7 * 24 * 3600; // seconds

// ---------------------------------------------------------------------------
// Public result types (serialized to the frontend)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpecMatch {
  pub brand: String,
  pub model: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub price: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub shop_link: Option<String>,
  /// Display name of the site the measurement came from (e.g. "squig.link").
  pub site: String,
}

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FetchedSpecs {
  #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
  pub r#match: Option<SpecMatch>,
  /// Frequency response curve as `[freq_hz, amp_db]` pairs, sorted by freq.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub fr_curve: Option<Vec<Vec<f64>>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub fr_source: Option<String>,
  /// One of: Dynamic, Planar, Balanced Armature, Electrostatic, Hybrid, Tribrid.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub driver_type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub impedance_ohms: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub sensitivity_db: Option<f64>,
  /// Remote product image to be downloaded on apply.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub image_url: Option<String>,
  /// URLs that contributed to the result (for display).
  #[serde(default)]
  pub sources: Vec<String>,
  /// Human-readable status notes (skips, partial failures).
  #[serde(default)]
  pub notes: Vec<String>,
}

// ---------------------------------------------------------------------------
// squig.link index structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
struct PbEntry {
  name: String,
  #[serde(default)]
  phones: Vec<PbPhone>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct PbPhone {
  name: String,
  #[serde(default)]
  price: Option<String>,
  #[serde(default, rename = "shopLink")]
  shop_link: Option<String>,
  #[serde(default)]
  file: Option<PbFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
enum PbFile {
  One(String),
  Many(Vec<String>),
}

impl PbFile {
  fn first(&self) -> Option<&str> {
    match self {
      PbFile::One(s) => Some(s.as_str()),
      PbFile::Many(v) => v.first().map(|s| s.as_str()),
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct SiteEntry {
  username: String,
  #[serde(default, rename = "urlType")]
  url_type: Option<String>,
  #[serde(default, rename = "altDomain")]
  alt_domain: Option<String>,
  #[serde(default)]
  dbs: Vec<SiteDb>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct SiteDb {
  #[serde(rename = "type")]
  kind: String,
  #[serde(default)]
  folder: Option<String>,
}

/// A measurement "source": where a phone book lives and what its label is.
struct Source {
  label: String, // display name, e.g. "squig.link" or "aden.squig.link"
  base: String, // e.g. "https://aden.squig.link"
  folder: String, // e.g. "/headphones/" or ""
  entries: Vec<PbEntry>,
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/// Lowercase, keep alphanumerics, collapse other runs to single spaces.
pub(crate) fn norm(s: &str) -> String {
  s.to_lowercase()
    .chars()
    .map(|c| if c.is_alphanumeric() { c } else { ' ' })
    .collect::<String>()
    .split(' ')
    .filter(|t| !t.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
}

/// Lowercase with all separators removed ("hd 600" -> "hd600").
pub(crate) fn compact(s: &str) -> String {
  s.to_lowercase()
    .chars()
    .filter(|c| c.is_alphanumeric())
    .collect()
}

pub(crate) fn model_score(a: &str, b: &str) -> f64 {
  let (na, nb) = (norm(a), norm(b));
  if na.is_empty() || nb.is_empty() {
    return 0.0;
  }
  if na == nb {
    return 1.0;
  }
  let (ca, cb) = (compact(a), compact(b));
  if !ca.is_empty() && ca == cb {
    return 0.98;
  }
  let (short, long) = if na.len() <= nb.len() { (&na, &nb) } else { (&nb, &na) };
  if long.contains(short) {
    return 0.85;
  }
  if (!cb.is_empty() && ca.contains(&cb)) || (!ca.is_empty() && cb.contains(&ca)) {
    return 0.8;
  }
  // Token overlap, scaled down — only a weak signal on its own.
  let ta: HashSet<&str> = na.split(' ').collect();
  let tb: HashSet<&str> = nb.split(' ').collect();
  let inter = ta.intersection(&tb).count() as f64;
  let min = ta.len().min(tb.len()) as f64;
  0.5 * (inter / min)
}

pub(crate) fn brand_score(a: &str, b: &str) -> f64 {
  let (na, nb) = (norm(a), norm(b));
  if na.is_empty() || nb.is_empty() {
    return 0.0;
  }
  if na == nb {
    return 1.0;
  }
  if !compact(a).is_empty() && compact(a) == compact(b) {
    return 0.95;
  }
  if na.contains(&nb) || nb.contains(&na) {
    return 0.9;
  }
  0.0
}

struct MatchInfo {
  public: SpecMatch,
  base: String,
  folder: String,
  stem: String,
}

/// Find the best (brand, model) match inside one phone book's entries.
fn best_match_in(
  source: &Source,
  brand: &str,
  model: &str,
) -> Option<MatchInfo> {
  let mut best: Option<(f64, MatchInfo)> = None;
  for entry in &source.entries {
    let bs = brand_score(brand, &entry.name);
    if bs < 0.85 {
      continue;
    }
    for phone in &entry.phones {
      let ms = model_score(model, &phone.name);
      if ms < 0.6 {
        continue;
      }
      let score = bs * 0.35 + ms * 0.65;
      let stem = match phone.file.as_ref().and_then(|f| f.first()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => continue,
      };
      let info = MatchInfo {
        public: SpecMatch {
          brand: entry.name.clone(),
          model: phone.name.clone(),
          price: phone.price.as_deref().and_then(parse_price),
          shop_link: phone
            .shop_link
            .clone()
            .filter(|s| !s.trim().is_empty()),
          site: source.label.clone(),
        },
        base: source.base.clone(),
        folder: source.folder.clone(),
        stem,
      };
      let better = match &best {
        None => true,
        Some((prev, _)) => score > *prev,
      };
      if better {
        best = Some((score, info));
      }
    }
  }
  best.map(|(_, m)| m)
}

/// Parse a price string like "$1,500" or "€ 299,50" into a number.
fn parse_price(s: &str) -> Option<f64> {
  let cleaned: String = s
    .chars()
    .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
    .collect();
  if cleaned.is_empty() {
    return None;
  }
  // Keep it simple: at most one decimal separator — drop commas, then try
  // parsing. Values like "1,500" (thousands) become "1500".
  let cleaned = cleaned.replace(',', "");
  let parts: Vec<&str> = cleaned.split('.').collect();
  let value = if parts.len() <= 2 {
    cleaned.parse::<f64>().ok()
  } else {
    cleaned.replace('.', "").parse::<f64>().ok()
  };
  value.filter(|v| *v > 0.0)
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

fn client() -> reqwest::Client {
  reqwest::Client::builder()
    .user_agent(USER_AGENT)
    .timeout(REQ_TIMEOUT)
    .build()
    .unwrap_or_else(|_| reqwest::Client::new())
}

/// GET a URL as text, bounded to PAGE_CAP characters. None on any failure.
async fn get_text(client: &reqwest::Client, url: &str) -> Option<String> {
  let resp = client.get(url).send().await.ok()?;
  if !resp.status().is_success() {
    return None;
  }
  let body = resp.text().await.ok()?;
  Some(body.chars().take(PAGE_CAP).collect())
}

/// GET a phone book (JSON array of entries) with a short timeout.
async fn get_phone_book(
  client: &reqwest::Client,
  url: &str,
) -> Option<Vec<PbEntry>> {
  let resp = client
    .get(url)
    .timeout(BOOK_TIMEOUT)
    .send()
    .await
    .ok()?;
  if !resp.status().is_success() {
    return None;
  }
  resp.json::<Vec<PbEntry>>().await.ok()
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

fn cache_dir() -> PathBuf {
  let root = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
  root.join("audio-vault").join("cache")
}

/// Load a cached file if it is newer than `ttl` seconds, else None.
pub(crate) fn load_cached(name: &str, ttl: u64) -> Option<String> {
  let dir = cache_dir();
  let file = dir.join(name);
  let ts_file = dir.join(format!("{name}.ts"));
  let ts: u64 = fs_read_to_string(&ts_file).unwrap_or_default().parse().ok()?;
  if now_secs().saturating_sub(ts) > ttl {
    return None;
  }
  fs_read_to_string(&file)
}

pub(crate) fn store_cached(name: &str, content: &str) {
  let dir = cache_dir();
  if std::fs::create_dir_all(&dir).is_err() {
    return;
  }
  let _ = std::fs::write(dir.join(format!("{name}.ts")), now_secs().to_string());
  let _ = std::fs::write(dir.join(name), content);
}

fn fs_read_to_string(p: &std::path::Path) -> Option<String> {
  std::fs::read_to_string(p).ok()
}

// ---------------------------------------------------------------------------
// Index loading (main phone book + headphone federation)
// ---------------------------------------------------------------------------

const MAIN_BOOK_URL: &str = "https://squig.link/data/phone_book.json";
const SITES_URL: &str = "https://squig.link/squigsites.json";

/// Load the main (root) squig.link phone book, cached 24h.
async fn load_main_book(client: &reqwest::Client) -> Option<Vec<PbEntry>> {
  if let Some(raw) = load_cached("main_phone_book.json", MAIN_BOOK_TTL) {
    return serde_json::from_str(&raw).ok();
  }
  let entries = get_phone_book(client, MAIN_BOOK_URL).await?;
  if let Ok(raw) = serde_json::to_string(&entries) {
    store_cached("main_phone_book.json", &raw);
  }
  Some(entries)
}

/// Site URL per squig.link's own convention (see squigsites.js):
/// root | altDomain | subdomain | lab folder.
fn site_base(site: &SiteEntry) -> Option<String> {
  match site.url_type.as_deref().unwrap_or("subdomain") {
    "root" => Some("https://squig.link".to_string()),
    "altDomain" => site.alt_domain.clone().filter(|s| s.starts_with("https://")),
    "subdomain" => Some(format!("https://{}.squig.link", site.username)),
    _ => Some(format!("https://squig.link/lab/{}", site.username)),
  }
}

/// Headphone (and earbud) sources from the federation, cached 7 days.
/// Each source's phone book is fetched in parallel with short timeouts.
async fn load_federation(
  client: &reqwest::Client,
) -> (Vec<Source>, Vec<String>) {
  let mut notes = Vec::new();

  let sites_raw = match load_cached("squigsites.json", FED_TTL) {
    Some(raw) => raw,
    None => {
      match get_text(client, SITES_URL).await {
        Some(raw) => {
          store_cached("squigsites.json", &raw);
          raw
        }
        None => {
          notes.push(note("spec.site_list_load_failed"));
          return (Vec::new(), notes);
        }
      }
    }
  };

  let sites: Vec<SiteEntry> = match serde_json::from_str(&sites_raw) {
    Ok(s) => s,
    Err(_) => {
      notes.push(note("spec.site_list_unreadable"));
      return (Vec::new(), notes);
    }
  };

  // Collect (label, base, folder) for Headphones/Earbuds dbs.
  let mut targets: Vec<(String, String, String)> = Vec::new();
  for site in &sites {
    let Some(base) = site_base(site) else { continue };
    for db in &site.dbs {
      if db.kind == "Headphones" || db.kind == "Earbuds" {
        let folder = db
          .folder
          .clone()
          .unwrap_or_else(|| "/".to_string());
        let label = base
          .strip_prefix("https://")
          .unwrap_or(&base)
          .to_string();
        targets.push((label, base.clone(), folder));
      }
    }
  }

  // Cache of already-fetched books (shared across the session).
  let cached: std::collections::HashMap<String, Vec<PbEntry>> =
    load_cached("hp_phone_books.json", FED_TTL)
      .and_then(|raw| serde_json::from_str(&raw).ok())
      .unwrap_or_default();

  let mut fresh_cache: std::collections::HashMap<String, Vec<PbEntry>> =
    cached.clone();
  let mut to_fetch: Vec<(String, String, String)> = Vec::new();
  for (label, base, folder) in &targets {
    let key = format!("{base}{folder}");
    if !fresh_cache.contains_key(&key) {
      to_fetch.push((label.clone(), base.clone(), folder.clone()));
    }
  }

  // Fetch missing books in parallel (small files, short timeouts).
  let handles: Vec<tokio::task::JoinHandle<(String, Option<Vec<PbEntry>>)>> = to_fetch
    .iter()
    .map(|(label, base, folder)| {
      let client = client.clone();
      let url = format!("{base}{folder}data/phone_book.json");
      let label = label.clone();
      tokio::spawn(async move {
        let entries = get_phone_book(&client, &url).await;
        (label, entries)
      })
    })
    .collect();

  let mut fetch_failures = 0usize;
  for h in handles {
    match h.await {
      Ok((label, Some(entries))) => {
        fresh_cache.insert(label, entries);
      }
      Ok((_, None)) => fetch_failures += 1,
      Err(_) => fetch_failures += 1,
    }
  }
  if !fresh_cache.is_empty()
    && let Ok(raw) = serde_json::to_string(&fresh_cache)
  {
    store_cached("hp_phone_books.json", &raw);
  }
  if fetch_failures > 0 && fresh_cache.is_empty() {
    notes.push(note("spec.federation_load_failed"));
  }

  // Rebuild sources in target order (cache or fetched).
  let mut sources = Vec::new();
  for (label, base, folder) in targets {
    if let Some(entries) = fresh_cache.remove(&label) {
      sources.push(Source {
        label: base
          .strip_prefix("https://")
          .unwrap_or(&base)
          .to_string(),
        base,
        folder,
        entries,
      });
    }
  }
  (sources, notes)
}

/// Try to match the device: main book first, then the federation (skipped
/// for IEMs — the main book already covers in-ear models).
async fn match_device(
  client: &reqwest::Client,
  brand: &str,
  model: &str,
  device_type: &str,
) -> (Option<MatchInfo>, Vec<String>) {
  let mut notes = Vec::new();

  let main_source = match load_main_book(client).await {
    Some(entries) => Source {
      label: "squig.link".to_string(),
      base: "https://squig.link".to_string(),
      folder: String::new(),
      entries,
    },
    None => {
      notes.push(note("spec.phonebook_load_failed"));
      return (None, notes);
    }
  };
  if let Some(m) = best_match_in(&main_source, brand, model) {
    return (Some(m), notes);
  }

  let is_iem = device_type.eq_ignore_ascii_case("iem");
  if is_iem {
    notes.push(note("spec.no_match_iem"));
    return (None, notes);
  }

  let (fed_sources, fed_notes) = load_federation(client).await;
  notes.extend(fed_notes);
  for source in &fed_sources {
    if let Some(m) = best_match_in(source, brand, model) {
      return (Some(m), notes);
    }
  }
  notes.push(note("spec.no_match_headphone"));
  (None, notes)
}

// ---------------------------------------------------------------------------
// Frequency response data
// ---------------------------------------------------------------------------

/// Fetch and parse the measurement curve for a matched entry.
/// Tries the left channel, then right, then a channel-less file.
async fn fetch_fr_curve(
  client: &reqwest::Client,
  info: &MatchInfo,
) -> Option<Vec<Vec<f64>>> {
  for suffix in [" L.txt", " R.txt", ".txt"] {
    let url = format!("{}{}data/{}{}", info.base, info.folder, info.stem, suffix);
    let Some(body) = get_text(client, &url).await else { continue };
    if let Some(curve) = parse_rew(&body) {
      return Some(curve);
    }
  }
  None
}

/// Parse REW measurement text: `*` comment headers, then whitespace-separated
/// `frequency amplitude [phase]` rows. Returns sorted `[f, a]` pairs.
fn parse_rew(body: &str) -> Option<Vec<Vec<f64>>> {
  let mut pts: Vec<Vec<f64>> = Vec::new();
  for line in body.lines() {
    let line = line.trim();
    if line.is_empty() || line.starts_with('*') {
      continue;
    }
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
      continue;
    }
    let Ok(f) = parts[0].parse::<f64>() else { continue };
    let Ok(a) = parts[1].parse::<f64>() else { continue };
    if !(1.0..25_000.0).contains(&f) || a.is_nan() || a.is_infinite() {
      continue;
    }
    pts.push(vec![f, a]);
  }
  pts.sort_by(|x, y| x[0].partial_cmp(&y[0]).unwrap_or(std::cmp::Ordering::Equal));
  if pts.len() >= 10 {
    Some(pts)
  } else {
    None
  }
}

// ---------------------------------------------------------------------------
// Web search (keyless DuckDuckGo)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct SearchHit {
  url: String,
  image: Option<String>,
}

fn urldecode(s: &str) -> String {
  let bytes = s.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    match bytes[i] {
      b'%' if i + 2 < bytes.len() => {
        let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
        match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
          Some(b) => {
            out.push(b);
            i += 3;
          }
          None => {
            out.push(bytes[i]);
            i += 1;
          }
        }
      }
      b'+' => {
        out.push(b' ');
        i += 1;
      }
      b => {
        out.push(b);
        i += 1;
      }
    }
  }
  String::from_utf8_lossy(&out).into_owned()
}

async fn search_duckduckgo(
  client: &reqwest::Client,
  query: &str,
) -> Result<Vec<SearchHit>, String> {
  // html.duckduckgo.com returns result links as
  // //duckduckgo.com/l/?uddg=<urlencoded>&rut=...
  let url = format!("https://html.duckduckgo.com/html/?q={}", url_encode(query));
  let html = get_text(client, &url).await.ok_or("DuckDuckGo request failed")?;
  let re = Regex::new(
    r#"class="result__a"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="result__a""#,
  )
  .unwrap();
  let mut hits = Vec::new();
  for caps in re.captures_iter(&html) {
    let raw = caps
      .get(1)
      .or_else(|| caps.get(2))
      .map(|m| m.as_str().to_string())
      .unwrap_or_default();
    let link = if raw.contains("uddg=") {
      raw.split("uddg=")
        .nth(1)
        .and_then(|rest| rest.split('&').next())
        .map(urldecode)
        .unwrap_or_default()
    } else {
      urldecode(&raw.replace('&', "&amp;"))
    };
    if link.starts_with("http") {
      hits.push(SearchHit { url: link, image: None });
    }
  }
  if hits.is_empty() {
    return Err(note("spec.search_unparsable"));
  }
  Ok(hits)
}

fn url_encode(s: &str) -> String {
  let mut out = String::new();
  for b in s.bytes() {
    match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
        out.push(b as char)
      }
      _ => out.push_str(&format!("%{b:02X}")),
    }
  }
  out
}


// ---------------------------------------------------------------------------
// Page parsing (lenient heuristics)
// ---------------------------------------------------------------------------

struct PageSpecs {
  driver_type: Option<String>,
  impedance: Option<f64>,
  sensitivity: Option<f64>,
  image_url: Option<String>,
}

/// Compiled regexes, built once.
struct Regexes {
  strip_script: regex::Regex,
  strip_style: regex::Regex,
  strip_noscript: regex::Regex,
  strip_tags: regex::Regex,
  ent_nbsp: regex::Regex,
  ent_amp: regex::Regex,
  ent_quot: regex::Regex,
  ent_apos: regex::Regex,
  ws: regex::Regex,
  og_a: regex::Regex,
  og_b: regex::Regex,
  ohm: regex::Regex,
  db: regex::Regex,
  driver_explicit: regex::Regex,
}

fn re() -> &'static Regexes {
  static R: OnceLock<Regexes> = OnceLock::new();
  R.get_or_init(|| Regexes {
    strip_script: Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap(),
    strip_style: Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap(),
    strip_noscript: Regex::new(r"(?is)<noscript[^>]*>.*?</noscript>").unwrap(),
    strip_tags: Regex::new(r"(?s)<[^>]+>").unwrap(),
    ent_nbsp: Regex::new(r"&nbsp;|&#160;").unwrap(),
    ent_amp: Regex::new(r"&amp;").unwrap(),
    ent_quot: Regex::new(r"&quot;").unwrap(),
    ent_apos: Regex::new(r"&#39;|&apos;").unwrap(),
    ws: Regex::new(r"\s+").unwrap(),
    og_a: Regex::new(
      r#"(?is)(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["'][^>]*?content\s*=\s*["']([^"']+)["']"#,
    )
    .unwrap(),
    og_b: Regex::new(
      r#"(?is)content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["']"#,
    )
    .unwrap(),
    ohm: Regex::new(r"(\d{1,4})\s*(?:ohm|Ω)\b").unwrap(),
    db: Regex::new(r"(\d{2,3})\s*(?:dB|db)\b").unwrap(),
    driver_explicit: Regex::new(
      r"(?i)(?:driver|transducer)\s*(?:type\s*)?[:\-]?\s*(planar magnetic|balanced armature|electrostatic|dynamic|tribrid|hybrid|planar)\b",
    )
    .unwrap(),
  })
}

fn strip_to_text(html: &str) -> String {
  let r = re();
  let no_script = r.strip_script.replace_all(html, " ");
  let no_script = r.strip_style.replace_all(&no_script, " ");
  let no_script = r.strip_noscript.replace_all(&no_script, " ");
  let no_tags = r.strip_tags.replace_all(&no_script, " ");
  let entities = r.ent_nbsp.replace_all(&no_tags, " ");
  let entities = r.ent_amp.replace_all(&entities, "&");
  let entities = r.ent_quot.replace_all(&entities, "\"");
  let entities = r.ent_apos.replace_all(&entities, "'");
  let collapsed = r.ws.replace_all(&entities, " ");
  collapsed.into_owned()
}

/// Extract specs from one HTML page. All fields are best-effort.
fn parse_page(html: &str, page_url: &str) -> PageSpecs {
  let r = re();
  let text = strip_to_text(html);

  // og:image / twitter:image (both attribute orders).
  let mut image_url = None;
  if let Some(m) = r.og_a.captures(html).or_else(|| r.og_b.captures(html)) {
    let raw = m[1].trim();
    if !raw.is_empty() {
      image_url = Some(resolve_url(raw, page_url));
    }
  }

  // Impedance: keyword, value within a ±150 char window.
  let impedance = find_value_near(&text, "impedance", &r.ohm, 150);

  // Sensitivity: keyword, then a 2-3 digit dB value.
  let sensitivity = find_value_near(&text, "sensitivity", &r.db, 150);

  // Driver type: weighted keyword scan.
  let driver_type = detect_driver(&text);

  PageSpecs {
    driver_type,
    impedance,
    sensitivity,
    image_url,
  }
}

/// Largest char boundary at or before `i`.
fn floor_char(s: &str, i: usize) -> usize {
  let i = i.min(s.len());
  if s.is_char_boundary(i) {
    i
  } else {
    let mut j = i;
    while j > 0 && !s.is_char_boundary(j) {
      j -= 1;
    }
    j
  }
}

/// Smallest char boundary at or after `i`.
fn ceil_char(s: &str, i: usize) -> usize {
  let i = i.min(s.len());
  if s.is_char_boundary(i) {
    i
  } else {
    let mut j = i;
    while j < s.len() && !s.is_char_boundary(j) {
      j += 1;
    }
    j
  }
}

/// Find the first number matching `value_re` near an occurrence of `keyword`
/// (case-insensitive; searching up to `window` chars before and after it).
fn find_value_near(
  text: &str,
  keyword: &str,
  value_re: &Regex,
  window: usize,
) -> Option<f64> {
  let kw_re = Regex::new(&format!(
    "(?i)\\b{}\\b",
    regex::escape(keyword)
  ))
  .ok()?;
  for m in kw_re.find_iter(text) {
    let pos = m.start();
    let from = floor_char(text, pos.saturating_sub(window));
    let to = ceil_char(text, (pos + m.len() + window).min(text.len()));
    let slice = &text[from..to];
    if let Some(caps) = value_re.captures(slice)
      && let Ok(v) = caps[1].parse::<f64>()
    {
      return Some(v);
    }
  }
  None
}

fn detect_driver(text: &str) -> Option<String> {
  // Decisive phrasing first: "Driver Type: Dynamic", "Transducer: Planar", …
  if let Some(m) = re().driver_explicit.captures(text) {
    return Some(match m[1].to_lowercase().as_str() {
      "dynamic" => "Dynamic".to_string(),
      "planar magnetic" | "planar" => "Planar".to_string(),
      "balanced armature" => "Balanced Armature".to_string(),
      "electrostatic" => "Electrostatic".to_string(),
      "hybrid" => "Hybrid".to_string(),
      "tribrid" => "Tribrid".to_string(),
      _ => return None,
    });
  }

  let lower = text.to_lowercase();
  let count = |needle: &str| -> f64 {
    let mut n = 0.0f64;
    let mut start = 0;
    while let Some(pos) = lower[start..].find(needle) {
      n += 1.0;
      start = start + pos + needle.len();
    }
    n
  };

  let mut score: Vec<(f64, &str)> = Vec::new();
  score.push((count("planar magnetic") * 4.0 + count("planar") * 2.0, "Planar"));
  score.push(
    (
      count("balanced armature") * 4.0 + count("ba driver") * 3.0 + count("ba drivers") * 3.0,
      "Balanced Armature",
    ),
  );
  score.push((count("electrostatic") * 3.0, "Electrostatic"));
  score.push(
    (
      count("dynamic driver") * 4.0 + count("dynamic drivers") * 4.0 + count("dynamic") * 1.0,
      "Dynamic",
    ),
  );
  score.push((count("tribrid") * 4.0, "Tribrid"));
  score.push((count("hybrid") * 2.0, "Hybrid"));

  let mut best: Option<(f64, &str)> = None;
  for (s, name) in score {
    if best.map_or(s >= 3.0, |b| s > b.0) {
      best = Some((s, name));
    }
  }
  best.filter(|(s, _)| *s >= 3.0).map(|(_, n)| n.to_string())
}

/// Resolve a (possibly relative) image URL against a page URL.
fn resolve_url(raw: &str, page_url: &str) -> String {
  if raw.starts_with("//") {
    return format!("https:{}", raw);
  }
  if raw.starts_with("http://") || raw.starts_with("https://") {
    return raw.to_string();
  }
  if let Some(pos) = page_url.find("://") {
    let scheme_end = pos + 3;
    if let Some(rest) = page_url.get(scheme_end..)
      && let Some(rel) = rest.find('/')
      && let Some(prefix) = page_url.get(..scheme_end + rel)
    {
      return format!("{}{}", prefix, raw);
    }
  }
  raw.to_string()
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/// Run the whole best-effort fetch. Never errors — problems land in `notes`.
pub async fn fetch_specs(
  brand: &str,
  model: &str,
  device_type: &str,
) -> FetchedSpecs {
  let mut out = FetchedSpecs::default();
  let brand = brand.trim();
  let model = model.trim();
  if brand.is_empty() || model.is_empty() {
    out.notes.push(note("common.brand_model_required"));
    return out;
  }

  let client = client();

  // 1) squig.link index match.
  let (match_info, book_notes) = match_device(&client, brand, model, device_type).await;
  out.notes.extend(book_notes);

  if let Some(info) = match_info {
    // 2) FR curve.
    match fetch_fr_curve(&client, &info).await {
      Some(curve) => {
        out.fr_curve = Some(curve);
        out.fr_source =
          Some(format!("{} (via squig.link)", info.public.site.clone()));
        out.sources
          .push(format!("https://{}.{}", info.public.site, ""));
      }
      None => out.notes.push(note_with(
        "spec.matched_no_data",
        serde_json::json!([
          info.public.brand,
          info.public.model,
          info.public.site,
        ]),
      )),
    }
    out.r#match = Some(info.public);
  }

  // 3) Web search → specs + product image.
  let query = format!(
    "\"{brand} {model}\" specifications impedance sensitivity"
  );
  match search_duckduckgo(&client, &query).await {
    Ok(hits) if hits.is_empty() => {
      out.notes.push(note("spec.search_no_results"));
    }
    Ok(hits) => {
      let mut driver: Option<String> = None;
      let mut impedance: Option<f64> = None;
      let mut sensitivity: Option<f64> = None;
      let mut image_url: Option<String> = None;
      let mut used: Vec<String> = Vec::new();
      let mut parsed_pages = 0usize;

      for hit in hits.iter().take(MAX_SPEC_PAGES) {
        if driver.is_some() && impedance.is_some() && sensitivity.is_some() && image_url.is_some()
        {
          break;
        }
        let Some(html) = get_text(&client, &hit.url).await else { continue };
        parsed_pages += 1;
        let ps = parse_page(&html, &hit.url);
        if ps.image_url.is_some() {
          used.push(hit.url.clone());
        }
        if image_url.is_none() {
          image_url = ps.image_url.or(hit.image.clone());
        }
        if driver.is_none() {
          driver = ps.driver_type;
        }
        if impedance.is_none() {
          impedance = ps.impedance;
        }
        if sensitivity.is_none() {
          sensitivity = ps.sensitivity;
        }
      }

      out.driver_type = driver;
      out.impedance_ohms = impedance;
      out.sensitivity_db = sensitivity;
      out.image_url = image_url;
      out.sources.extend(used);

      let got_any = out.driver_type.is_some()
        || out.impedance_ohms.is_some()
        || out.sensitivity_db.is_some()
        || out.image_url.is_some();
      if !got_any {
        out.notes.push(note_with(
          "spec.search_no_specs",
          serde_json::json!([parsed_pages]),
        ));
      }
    }
    Err(e) => {
      if e == note("spec.search_unparsable") {
        out.notes.push(e);
      } else {
        out.notes.push(note_with(
          "spec.search_failed",
          serde_json::json!([e]),
        ));
      }
    }
  }

  out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn norm_and_compact() {
    assert_eq!(norm("HD 600"), "hd 600");
    assert_eq!(norm("hd-600"), "hd 600");
    assert_eq!(compact("HD 600"), "hd600");
    assert_eq!(compact("hd-600"), "hd600");
  }

  #[test]
  fn model_matching() {
    assert!(model_score("HD 600", "HD 600") > 0.99);
    assert!(model_score("hd 600", "HD600") > 0.9);
    assert!(model_score("HD 600", "HD 600 Anniversary Edition") > 0.8);
    assert!(model_score("IE 300", "IE 900") < 0.6);
    assert!(model_score("MTW2", "Momentum TW2") > 0.5);
  }

  #[test]
  fn brand_matching() {
    assert!(brand_score("Sennheiser", "Sennheiser") > 0.99);
    assert!(brand_score("senn", "Sennheiser") > 0.85);
    assert!(brand_score("Sony", "Sennheiser") < 0.85);
  }

  #[test]
  fn price_parsing() {
    assert_eq!(parse_price("$1,500"), Some(1500.0));
    assert_eq!(parse_price("€299"), Some(299.0));
    assert_eq!(parse_price("349.50"), Some(349.5));
    assert_eq!(parse_price(""), None);
    assert_eq!(parse_price("free"), None);
  }

  #[test]
  fn rew_parsing() {
    let body = "* Measurement data measured by REW V5.19\n* Source: x\n20.0\t76.7\t-158.0\n21.0\t76.8\t-159.0\n";
    // Too few points -> None.
    assert!(parse_rew(body).is_none());
    let mut body = String::from("* header\n");
    for i in 0..20 {
      body.push_str(&format!("{} 70.0 0.0\n", 20.0 + i as f64 * 100.0));
    }
    let pts = parse_rew(&body).unwrap();
    assert_eq!(pts.len(), 20);
    assert!(pts.first().unwrap()[0] < pts.last().unwrap()[0]);
  }

  #[test]
  fn ddg_url_decoding() {
    assert_eq!(
      urldecode("https%3A%2F%2Ffullspecs.net%2Fwired%2Dheadphone%2Fsennheiser%2Fhd%2D600"),
      "https://fullspecs.net/wired-headphone/sennheiser/hd-600"
    );
    assert_eq!(urldecode("a+b%20c"), "a b c");
  }

  #[test]
  fn page_parsing() {
    let html = r#"
      <html><head>
        <meta property="og:image" content="https://cdn.example.com/hd600.jpg">
      </head><body>
        <h1>Sennheiser HD 600 Specifications</h1>
        <p>Driver Type Dynamic. Impedance 300 ohm. Sensitivity 97 dB SPL.
        Driver Diameter 42 mm.</p>
      </body></html>
    "#;
    let ps = parse_page(html, "https://example.com/specs");
    assert_eq!(ps.impedance, Some(300.0));
    assert_eq!(ps.sensitivity, Some(97.0));
    assert_eq!(ps.driver_type.as_deref(), Some("Dynamic"));
    assert_eq!(
      ps.image_url.as_deref(),
      Some("https://cdn.example.com/hd600.jpg")
    );
  }

  #[test]
  fn page_parsing_relative_image() {
    let html = r#"<html><head><meta content="/img/x.png" property="og:image"></head><body>Impedance: 32 Ω, Sensitivity: 104 dB/mW. planar magnetic driver.</body></html>"#;
    let ps = parse_page(html, "https://vendor.example.com/products/x");
    assert_eq!(ps.image_url.as_deref(), Some("https://vendor.example.com/img/x.png"));
    assert_eq!(ps.impedance, Some(32.0));
    assert_eq!(ps.sensitivity, Some(104.0));
    assert_eq!(ps.driver_type.as_deref(), Some("Planar"));
  }

  #[test]
  fn resolve_url_helper() {
    assert_eq!(
      resolve_url("//cdn.x.com/a.png", "https://example.com/p"),
      "https://cdn.x.com/a.png"
    );
    assert_eq!(
      resolve_url("/img/a.png", "https://example.com/p/q"),
      "https://example.com/img/a.png"
    );
    assert_eq!(
      resolve_url("https://a.b/c.png", "https://example.com"),
      "https://a.b/c.png"
    );
  }
}
