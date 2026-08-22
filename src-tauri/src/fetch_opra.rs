//! OPRA preset lookup (primary PEQ source).
//!
//! The [OPRA](https://github.com/opra-project/OPRA) database is a JSONL file
//! of vendors, products and community EQ presets (AutoEQ, oratory1990,
//! Rtings/AutoEQ, …), licensed CC BY-SA 4.0. Following their `CONSUMING.md`
//! guidance for personal, non-commercial use we fetch from the Roon Labs
//! mirror (GitHub `dist/` as fallback), cache it under the XDG cache dir
//! for 24 h, and never ship or redistribute it.
//!
//! Everything here is best-effort and isolated: network/parse problems land
//! in the result's `note`, never as an error, so the form can fall back to
//! file import. Preset authorship travels with the data (CC BY-SA) so the
//! frontend can persist it as provenance.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

use crate::fetch_specs::{brand_score, load_cached, model_score, store_cached, USER_AGENT};
use crate::note;

const DB_NAME: &str = "opra_database_v1.jsonl";
/// Official non-commercial mirror (per docs/CONSUMING.md).
const PRIMARY_URL: &str = "http://opra.roonlabs.net/database_v1.jsonl";
/// Up-to-the-minute fallback; `dist/` is committed after every repo commit.
const FALLBACK_URL: &str = "https://raw.githubusercontent.com/opra-project/OPRA/main/dist/database_v1.jsonl";
const DB_TTL: u64 = 24 * 3600; // seconds
const DB_TIMEOUT: Duration = Duration::from_secs(45);
/// The live DB is ~13 MB; 200 MB is a generous ceiling against growth.
const MAX_DB_BYTES: usize = 200 * 1024 * 1024;
const MAX_CANDIDATES: usize = 8;

// ---------------------------------------------------------------------------
// Public result types (serialized to the frontend)
// ---------------------------------------------------------------------------

/// One EQ band, already mapped to the Audio Vault PEQ model.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpraBandInfo {
  /// `PK`, `LSC` or `HSC`.
  pub kind: String,
  /// Center frequency, Hz.
  pub freq: f64,
  /// Gain, dB.
  pub gain: f64,
  /// Filter Q.
  pub q: f64,
}

/// One community EQ preset for a product.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpraProfileInfo {
  /// Stable OPRA eq id (e.g. `sennheiser:ie800::autoeq`).
  pub id: String,
  /// Preset author — must be shown with the preset (CC BY-SA).
  pub author: String,
  /// Preset display name (e.g. "Harman Target", "Measured by Innerfidelity").
  pub details: String,
  /// Optional source page.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub link: Option<String>,
  /// Profile-level overall gain in dB. Not applicable to the band model —
  /// surfaced as a note, never applied.
  pub overall_gain_db: f64,
  pub bands: Vec<OpraBandInfo>,
}

/// A matched product with all of its presets.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpraCandidate {
  pub vendor: String,
  pub name: String,
  /// `in_ear`, `over_the_ear`, `earbuds`, `on_ear`, …
  pub subtype: String,
  pub profiles: Vec<OpraProfileInfo>,
}

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpraFetchResult {
  pub candidates: Vec<OpraCandidate>,
  /// Info/warning: stale-cache notice, or an error message when no data
  /// could be loaded at all. `None` means a clean, up-to-date lookup.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// JSONL wire format
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OpraEntry {
  Vendor { id: String, data: Option<VendorData> },
  Product { id: String, data: Option<ProductData> },
  Eq { id: String, data: Option<EqData> },
  #[serde(other)]
  Other,
}

#[derive(Deserialize)]
struct VendorData {
  #[serde(default)]
  name: String,
}

#[derive(Deserialize)]
struct ProductData {
  #[serde(default)]
  name: String,
  #[serde(default, rename = "vendor_id")]
  vendor_id: String,
  #[serde(default)]
  subtype: String,
}

#[derive(Deserialize)]
struct EqData {
  #[serde(default)]
  author: String,
  #[serde(default)]
  details: String,
  #[serde(default, rename = "product_id")]
  product_id: String,
  #[serde(default)]
  link: Option<String>,
  #[serde(default)]
  parameters: Option<EqParameters>,
}

#[derive(Deserialize)]
struct EqParameters {
  #[serde(default, rename = "gain_db")]
  gain_db: f64,
  #[serde(default)]
  bands: Vec<RawBand>,
}

#[derive(Deserialize)]
struct RawBand {
  #[serde(rename = "type", default)]
  kind: String,
  #[serde(default)]
  frequency: f64,
  #[serde(default, rename = "gain_db")]
  gain_db: f64,
  #[serde(default)]
  q: f64,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// A product with its display names and all of its presets.
struct Product {
  vendor: String,
  name: String,
  subtype: String,
  profiles: Vec<OpraProfileInfo>,
}

/// Map one raw OPRA band to the Audio Vault PEQ model.
///
/// Only `peak_dip` / `low_shelf` / `high_shelf` map (99.99 % of the whole
/// database); anything else — today only the five `low_pass` bands — is
/// dropped. Out-of-range or non-finite values are dropped too.
fn map_band(b: &RawBand) -> Option<OpraBandInfo> {
  let kind = match b.kind.as_str() {
    "peak_dip" => "PK",
    "low_shelf" => "LSC",
    "high_shelf" => "HSC",
    _ => return None,
  };
  if b.frequency.is_nan() || !(1.0..=20_000.0).contains(&b.frequency) {
    return None;
  }
  if !b.gain_db.is_finite() || !b.q.is_finite() {
    return None;
  }
  Some(OpraBandInfo {
    kind: kind.to_string(),
    freq: b.frequency,
    gain: b.gain_db,
    q: b.q,
  })
}

/// Parse the full JSONL document into the in-memory product index.
/// Malformed lines and unknown entry types are skipped, never fatal.
fn parse_database(raw: &str) -> Vec<Product> {
  let mut vendors: HashMap<String, String> = HashMap::new();
  let mut products: HashMap<String, (String, String, String)> = HashMap::new();
  let mut profiles: HashMap<String, Vec<OpraProfileInfo>> = HashMap::new();

  for line in raw.lines() {
    let line = line.trim();
    if line.is_empty() {
      continue;
    }
    let Ok(entry) = serde_json::from_str::<OpraEntry>(line) else {
      continue;
    };
    match entry {
      OpraEntry::Vendor { id, data: Some(d) } => {
        if !d.name.trim().is_empty() {
          vendors.insert(id, d.name.trim().to_string());
        }
      }
      OpraEntry::Product { id, data: Some(d) } => {
        if d.name.trim().is_empty() {
          continue;
        }
        products.insert(
          id,
          (d.vendor_id, d.name.trim().to_string(), d.subtype),
        );
      }
      OpraEntry::Eq { id, data: Some(d) } => {
        let Some(params) = d.parameters else { continue };
        let bands: Vec<OpraBandInfo> = params
          .bands
          .iter()
          .filter_map(map_band)
          .collect();
        if bands.is_empty() {
          continue;
        }
        profiles
          .entry(d.product_id)
          .or_default()
          .push(OpraProfileInfo {
            id,
            author: d.author,
            details: d.details,
            link: d.link,
            overall_gain_db: params.gain_db,
            bands,
          });
      }
      OpraEntry::Vendor { .. }
      | OpraEntry::Product { .. }
      | OpraEntry::Eq { .. }
      | OpraEntry::Other => {}
    }
  }

  let mut out: Vec<Product> = Vec::with_capacity(products.len());
  for (id, (vendor_id, name, subtype)) in products {
    let vendor = vendors
      .get(&vendor_id)
      .cloned()
      .unwrap_or_else(|| vendor_id.clone());
    let mut profs = profiles.remove(&id).unwrap_or_default();
    // AutoEQ first, then author/details — the most-used presets on top.
    profs.sort_by(|a, b| {
      let rank = |p: &OpraProfileInfo| {
        if p.author.eq_ignore_ascii_case("autoeq") { 0 } else { 1 }
      };
      rank(a)
        .cmp(&rank(b))
        .then_with(|| a.author.cmp(&b.author))
        .then_with(|| a.details.cmp(&b.details))
    });
    out.push(Product {
      vendor,
      name,
      subtype,
      profiles: profs,
    });
  }
  out
}

// ---------------------------------------------------------------------------
// Database loading (download + cache)
// ---------------------------------------------------------------------------

struct Db {
  products: Vec<Product>,
  note: Option<String>,
}

async fn download(client: &reqwest::Client, url: &str) -> Option<String> {
  let resp = client.get(url).timeout(DB_TIMEOUT).send().await.ok()?;
  if !resp.status().is_success() {
    return None;
  }
  let bytes = resp.bytes().await.ok()?;
  if bytes.len() > MAX_DB_BYTES {
    return None;
  }
  String::from_utf8(bytes.to_vec()).ok()
}

/// Resolve the product index: fresh cache → download (mirror, then GitHub)
/// → stale cache → nothing (with a note).
async fn load_database(client: &reqwest::Client) -> Db {
  // 1) Fresh cache.
  if let Some(raw) = load_cached(DB_NAME, DB_TTL) {
    let products = parse_database(&raw);
    if !products.is_empty() {
      return Db { products, note: None };
    }
  }
  // 2) Download: primary mirror, then GitHub fallback.
  for url in [PRIMARY_URL, FALLBACK_URL] {
    if let Some(raw) = download(client, url).await {
      let products = parse_database(&raw);
      if !products.is_empty() {
        store_cached(DB_NAME, &raw);
        return Db { products, note: None };
      }
    }
  }
  // 3) Stale cache (TTL ignored) — offline use keeps working.
  if let Some(raw) = load_cached(DB_NAME, u64::MAX) {
    let products = parse_database(&raw);
    if !products.is_empty() {
      return Db {
        products,
        note: Some(note("opra.stale_cache")),
      };
    }
  }
  Db {
    products: Vec::new(),
    note: Some(note("opra.load_failed")),
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/// Score one product against the queried brand/model.
///
/// Both a brand relation (≥ 0.85, so the vendor actually matches) and a
/// model relation (≥ 0.6) are required — model numbers like "HD 600" are
/// only meaningful together with the vendor.
fn score_product(p: &Product, brand: &str, model: &str) -> f64 {
  if p.vendor.trim().is_empty() || p.name.trim().is_empty() {
    return 0.0;
  }
  let bs = brand_score(brand, &p.vendor);
  if bs < 0.85 {
    return 0.0;
  }
  let ms = model_score(model, &p.name);
  if ms < 0.6 {
    return 0.0;
  }
  bs * 0.35 + ms * 0.65
}

/// Best-matching products (up to `MAX_CANDIDATES`), score-descending.
fn match_products(products: &[Product], brand: &str, model: &str) -> Vec<OpraCandidate> {
  let brand = brand.trim();
  let model = model.trim();
  if brand.is_empty() || model.is_empty() {
    return Vec::new();
  }
  let mut scored: Vec<(f64, &Product)> = products
    .iter()
    .filter_map(|p| {
      let s = score_product(p, brand, model);
      (s > 0.0).then_some((s, p))
    })
    .collect();
  scored.sort_by(|a, b| {
    b.0.partial_cmp(&a.0)
      .unwrap_or(std::cmp::Ordering::Equal)
      .then_with(|| a.1.name.cmp(&b.1.name))
  });
  scored
    .into_iter()
    .take(MAX_CANDIDATES)
    .map(|(_, p)| OpraCandidate {
      vendor: p.vendor.clone(),
      name: p.name.clone(),
      subtype: p.subtype.clone(),
      profiles: p.profiles.clone(),
    })
    .collect()
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/// Run the whole best-effort OPRA lookup. Never errors — problems land in
/// `note`, so the form can decide between "not found" and "check failed".
pub async fn fetch_opra_presets(brand: &str, model: &str) -> OpraFetchResult {
  let brand = brand.trim();
  let model = model.trim();
  if brand.is_empty() || model.is_empty() {
    return OpraFetchResult {
      candidates: Vec::new(),
      note: Some(note("common.brand_model_required")),
    };
  }

  let client = reqwest::Client::builder()
    .user_agent(USER_AGENT)
    .timeout(DB_TIMEOUT)
    .build()
    .unwrap_or_else(|_| reqwest::Client::new());

  let db = load_database(&client).await;
  if db.products.is_empty() {
    return OpraFetchResult {
      candidates: Vec::new(),
      note: db.note,
    };
  }
  let candidates = match_products(&db.products, brand, model);
  OpraFetchResult {
    candidates,
    note: db.note,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;

  /// One vendor, one product, one profile with all three supported band
  /// types plus one `low_pass` band that must be skipped.
  const SYNTHETIC: &str = concat!(
    r#"{"type":"vendor","id":"acme","data":{"name":"ACME Audio"}}"#,
    "\n",
    r#"{"type":"product","id":"acme::x100","data":{"name":"X 100","type":"headphones","subtype":"in_ear","vendor_id":"acme"}}"#,
    "\n",
    r#"{"type":"eq","id":"acme:x100::autoeq","data":{"author":"AutoEQ","details":"Measured by Example","type":"parametric_eq","parameters":{"gain_db":-4,"bands":[{"type":"low_shelf","frequency":105,"gain_db":-1.4,"q":0.7},{"type":"peak_dip","frequency":170,"gain_db":-1.9,"q":1.47},{"type":"high_shelf","frequency":12000,"gain_db":2.5,"q":0.8},{"type":"low_pass","frequency":8000,"slope":18}]},"product_id":"acme::x100"}}"#
  );

  fn synthetic_products() -> Vec<Product> {
    parse_database(&SYNTHETIC)
  }

  #[test]
  fn parse_database_synthetic() {
    let products = synthetic_products();
    assert_eq!(products.len(), 1);
    let p = &products[0];
    assert_eq!(p.vendor, "ACME Audio");
    assert_eq!(p.name, "X 100");
    assert_eq!(p.subtype, "in_ear");
    assert_eq!(p.profiles.len(), 1);
    let prof = &p.profiles[0];
    assert_eq!(prof.id, "acme:x100::autoeq");
    assert_eq!(prof.author, "AutoEQ");
    assert_eq!(prof.overall_gain_db, -4.0);
    // low_pass band is skipped; the other three map 1:1.
    assert_eq!(prof.bands.len(), 3);
    let kinds: Vec<&str> =
      prof.bands.iter().map(|b| b.kind.as_str()).collect();
    assert_eq!(kinds, vec!["LSC", "PK", "HSC"]);
    assert_eq!(prof.bands[1].freq, 170.0);
    assert_eq!(prof.bands[1].gain, -1.9);
    assert_eq!(prof.bands[1].q, 1.47);
  }

  #[test]
  fn parse_database_skips_garbage_and_unknown_types() {
    let raw = "not json at all\n"
      .to_string()
      + r#"{"type":"mystery","id":"x","data":{}}"#
      + "\n"
      + r#"{"type":"vendor","id":"acme","data":{"name":"ACME Audio"}}"#
      + "\n"
      + SYNTHETIC
      + "\n\n";
    let products = parse_database(&raw);
    // The duplicated vendor line is a map overwrite, not a new product.
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].profiles.len(), 1);
    assert_eq!(products[0].profiles[0].bands.len(), 3);
  }

  #[test]
  fn parse_database_drops_profiles_without_usable_bands() {
    let raw = r#"{"type":"vendor","id":"acme","data":{"name":"ACME"}}"#;
    let raw = raw.to_string()
      + "\n"
      + r#"{"type":"product","id":"acme::y","data":{"name":"Y","vendor_id":"acme"}}"#
      + "\n"
      + r#"{"type":"eq","id":"acme:y::only_lowpass","data":{"author":"X","details":"d","parameters":{"gain_db":0,"bands":[{"type":"low_pass","frequency":8000,"slope":18}]},"product_id":"acme::y"}}"#
      + "\n"
      + r#"{"type":"eq","id":"acme:y::no_params","data":{"author":"X","details":"d","product_id":"acme::y"}}"#;
    let products = parse_database(&raw);
    assert_eq!(products.len(), 1);
    assert!(products[0].profiles.is_empty());
  }

  #[test]
  fn band_mapping_out_of_range() {
    let b = |kind: &str, f: f64| RawBand {
      kind: kind.to_string(),
      frequency: f,
      gain_db: 1.0,
      q: 1.0,
    };
    assert!(map_band(&b("peak_dip", 100.0)).is_some());
    assert!(map_band(&b("peak_dip", 0.5)).is_none());
    assert!(map_band(&b("peak_dip", 25_000.0)).is_none());
    assert!(map_band(&b("low_pass", 100.0)).is_none());
    let nan = RawBand {
      kind: "peak_dip".to_string(),
      frequency: 100.0,
      gain_db: f64::NAN,
      q: 1.0,
    };
    assert!(map_band(&nan).is_none());
  }

  fn product(vendor: &str, name: &str) -> Product {
    Product {
      vendor: vendor.to_string(),
      name: name.to_string(),
      subtype: "in_ear".to_string(),
      profiles: vec![OpraProfileInfo {
        id: "x".to_string(),
        author: "AutoEQ".to_string(),
        details: "d".to_string(),
        link: None,
        overall_gain_db: 0.0,
        bands: vec![OpraBandInfo {
          kind: "PK".to_string(),
          freq: 100.0,
          gain: 1.0,
          q: 1.0,
        }],
      }],
    }
  }

  #[test]
  fn matching_exact_and_case_insensitive() {
    let products = vec![product("Sennheiser", "IE 800")];
    let m = match_products(&products, "sennheiser", "ie 800");
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].name, "IE 800");
    assert_eq!(m[0].profiles.len(), 1);
  }

  #[test]
  fn matching_variants() {
    let products = vec![
      product("Sennheiser", "IE 800"),
      product("Sennheiser", "IE 800 S"),
      product("Beyerdynamic", "DT 900 Pro X"),
    ];
    // Containment: "IE 800" matches both "IE 800" (exact) and "IE 800 S".
    let m = match_products(&products, "sennheiser", "ie 800");
    assert!(m.len() >= 1);
    assert_eq!(m[0].name, "IE 800");
    // Compact: "DT900 Pro X" vs "DT 900 Pro X".
    let m = match_products(&products, "beyerdynamic", "dt900 pro x");
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].name, "DT 900 Pro X");
  }

  #[test]
  fn matching_requires_brand_and_model() {
    let products = vec![product("Sennheiser", "IE 800")];
    // Right brand, wrong model.
    assert!(match_products(&products, "sennheiser", "HD 600").is_empty());
    // Right model, wrong brand.
    assert!(match_products(&products, "Beyerdynamic", "IE 800").is_empty());
    // Empty input.
    assert!(match_products(&products, "", "IE 800").is_empty());
    assert!(match_products(&products, "Sennheiser", "  ").is_empty());
  }

  #[test]
  fn candidates_capped() {
    let products: Vec<Product> = (0..10)
      .map(|i| product("Sennheiser", &format!("IE 800 V{i}")))
      .collect();
    let m = match_products(&products, "sennheiser", "IE 800 V4");
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].name, "IE 800 V4");
  }

  #[test]
  fn candidate_limit_is_eight() {
    // Ten products whose names all contain the queried model string.
    let products: Vec<Product> = (0..10)
      .map(|i| product("Sennheiser", &format!("Tuned X{i}")))
      .collect();
    let m = match_products(&products, "sennheiser", "Tuned X");
    assert_eq!(m.len(), MAX_CANDIDATES);
  }

  /// End-to-end guard against upstream format drift: OPRA restructured
  /// their dump in 2026-08 (nested UUID profiles → flat vendor_id /
  /// product_id references, slug ids). If the live format changes again,
  /// this test fails loudly instead of OPRA silently returning nothing.
  /// Skipped when the local dump is not available (CI-safe).
  #[test]
  fn real_database_parses_and_matches_when_available() {
    let Ok(raw) = std::fs::read_to_string("/tmp/opra_db.jsonl") else {
      eprintln!("skipping: /tmp/opra_db.jsonl not available");
      return;
    };
    let products = parse_database(&raw);
    assert!(products.len() > 5000, "parsed {} products", products.len());

    let c = match_products(&products, "moondrop", "lan");
    assert!(!c.is_empty(), "Moondrop LAN not matched");
    assert_eq!(c[0].vendor, "Moondrop");
    assert_eq!(c[0].name, "LAN");
    assert!(!c[0].profiles.is_empty(), "LAN has no profiles");
    // Top profile is an AutoEQ measurement (sorted first). Structural
    // invariants only — specific measurements/band values change with
    // upstream data and must not be pinned here.
    let top = &c[0].profiles[0];
    assert_eq!(top.author, "AutoEQ");
    assert!(top.bands.iter().all(|b| {
      ["PK", "LSC", "HSC"].contains(&b.kind.as_str())
        && (1.0..=20_000.0).contains(&b.freq)
        && b.gain.is_finite()
        && b.q.is_finite()
    }));
    assert!(top.overall_gain_db.is_finite());
  }
}
