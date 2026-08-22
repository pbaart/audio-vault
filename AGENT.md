# Audio Vault — Linux (Fedora/RPM) Native Desktop

Audio Vault is a lightweight, local-first Linux desktop application designed
for audiophiles to manage headphones, IEMs, frequency response measurement
curves, technical specifications, and tube amplifier compatibility.

**Status:** Phases 1 (MVP), 2 (web auto-fetch) and 3 (OPRA preset lookup)
implemented in this repository.
The authoritative feature/spec document is `docs/audio-vault-spec.md`.

**License:** MIT — see [LICENSE](LICENSE). Copyright (c) 2026 pbaart.

---

## 🛠️ Linux Tech Stack & Packaging

- **Desktop Shell:** Tauri v2 (Rust backend, WebKitGTK on Linux)
- **Frontend UI:** React 19 + TypeScript + Vite + Tailwind CSS v4
  (dark theme token system in `src/index.css` + `src/lib/themes.ts`;
  5 selectable color schemes: Tokyo Night default, Gruvbox Dark, Dracula,
  Catppuccin Mocha, Monokai)
- **Database:** `tauri-plugin-sql` with SQLite
- **File System:** `tauri-plugin-fs` & `tauri-plugin-dialog`
- **Image display:** Tauri asset protocol (`protocol-asset` feature,
  scope `$APPDATA/media/**`) with a base64 data-URL fallback command
- **Packaging Targets:** Linux `.deb` + `.rpm` + `.AppImage`, macOS `.app` + `.dmg`
  (built via GitHub Actions CI — `.github/workflows/tauri.yml`); Windows out of scope

---

## 🐧 Fedora Dependencies & Setup

```bash
# Required build dependencies for Fedora
# (librsvg2-devel is needed by the AppImage gtk bundling plugin)
sudo dnf install rpm-build gcc-c++ webkit2gtk4.1-devel openssl-devel librsvg2-devel
```

Bundle config lives in `src-tauri/tauri.conf.json`:

```json
{ "bundle": { "active": true, "targets": ["deb", "rpm"] } }
```

**App icon:** the 1024×1024 source lives in `icons/icon-1024.png`
(“sound waves” design — dark Tokyo Night tile, light headband, accent
blue cups with fading wave arcs). All sizes in `src-tauri/icons/`
(png/ico/icns) are generated from it via
`npm run tauri icon icons/icon-1024.png` — never hand-edit the
individual icon files.

---

## 📂 Linux XDG File Paths

The app strictly follows the Linux XDG Base Directory Specification:

- **Database Path:** `~/.local/share/audio-vault/collection.db`
- **Media/Images Path:** `~/.local/share/audio-vault/media/`
- **Web-fetch cache:** `~/.local/share/audio-vault/cache/` (squig.link
  phone books; 24 h main index, 7 days federation)
- **Config Path:** `~/.config/audio-vault/config.json`

Paths are resolved on the Rust side (`dirs` crate, `init_app_data` command)
and created idempotently on first launch. The app identifier is `audio-vault`,
so Tauri's `$APPDATA` base resolves to the same location for the asset scope.

---

## 🗄️ Database Schema (`devices` table)

Created by SQL migration v1, extended by v2–v15 (see `src-tauri/src/lib.rs`):

```sql
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,                    -- Brand / Manufacturer
  model TEXT NOT NULL,                    -- Model Name
  type TEXT NOT NULL,                     -- 'Over-Ear' | 'On-Ear' | 'IEM'
  color TEXT,                             -- v2: free-text color (autocomplete)
  manufacturer_url TEXT,                  -- v3: manufacturer website (http/https)
  webshop_url TEXT,                       -- v4: webshop where bought (http/https)
  image_path TEXT,                        -- Relative path in media/
  price REAL,                             -- EUR/USD
  purchase_date TEXT,                     -- ISO 'YYYY-MM-DD'
  driver_type TEXT,                       -- 'Dynamic' | 'Planar' | 'BA' | 'Electrostatic' | 'Hybrid' | 'Tribrid'
  impedance_ohms INTEGER,                 -- Nominal impedance (Ω)
  sensitivity_db REAL,                    -- Sensitivity (dB/mW or dB/V)
  connector_type TEXT,
  tube_amp_suitable TEXT,                 -- 'Yes' | 'No' | 'OTL Only' | 'Transformer Only'
  drive_difficulty TEXT,                  -- 'Easy' | 'Moderate' | 'Demanding'
  sound_signature TEXT,                   -- 'Neutral' | 'Warm' | 'V-Shaped' | 'Bright' | 'Harman' | 'Dark'
  soundstage_rating INTEGER,              -- 0.5–5 in 0.5 steps, stored 2x (v14)
  listening_notes TEXT,
  fr_graph_path TEXT,                     -- Relative path to measurement graph image
  peq_settings TEXT,                      -- JSON array: [{ type, freq_hz, gain_db, q }]
  peq_source TEXT,                        -- Provenance of the bands (OPRA preset / imported file); NULL when manual/none
  custom_fields TEXT,                     -- JSON array: [{ key, value }]
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  overall_rating INTEGER,                 -- v9: 0.5–5 in 0.5 steps, stored 2x
  imaging_rating INTEGER,                 -- v10: The Sound attribute, stored 2x
  detail_retrieval_rating INTEGER,        -- v11: The Sound attribute, stored 2x
  timbre_rating INTEGER,                  -- v12: The Sound attribute, stored 2x
  tonal_balance_rating INTEGER,           -- v13: The Sound attribute, stored 2x
  updated_at TEXT                         -- v15: last save; NULL pre-v15 (UI falls back to created_at)
);
```

---

## 🧮 Tube-amp Compatibility Rule

Badge is computed (and persisted) on every save, from impedance + driver
type, and can be overridden manually per device:

| Condition | Stored value | Shown in UI |
| --- | --- | --- |
| Impedance ≥ 120 Ω | `Yes` | **Perfect Match** |
| 32–119 Ω + Dynamic driver | `OTL Only` | **Limited Compatibility** |
| 32–119 Ω + non-Dynamic driver | `Transformer Only` | **Not Advised** |
| < 32 Ω | `No` | **Not Possible** |
| Impedance unknown (NULL) | — | no badge |

Display labels live in the locale files (`tube.badges.*`, rendered via
`tubeBadgeLabel`); the DB keeps the short stored codes, so relabeling needs no migration.

---

## ⚙️ Core UI & Data Management

1. **Screens:** Collection Overview (default), Device Detail, Add/Edit dialog
   (modal), Settings. No router — state-based navigation in `App.tsx`.
2. **Collection Overview:** grid of cards (image, name, type, key specs,
   tube badge, hover edit/delete) or list/table view (toggle persisted in
   localStorage; table rows carry edit + delete icon buttons in a right
   Actions column, stop-propagation so row click still opens the detail),
   search box, filters (type / driver / tube-amp suitability),
   sort (name / added / modified / impedance / price) with direction toggle.
3. **Add/Edit dialog:** all device fields with validation (required brand,
   model, type; numeric ranges), image + FR-graph picking via the native
   file dialog (files are copied into `media/`), dynamic custom key/value
   field rows, a live tube-badge preview, and the Phase 2 **Web fetch**
   panel (see below). There are **no manual PEQ rows** — the PEQ section
   is fully driven by OPRA lookup + file import (see Phase 3 below).
   The purchase date is a text input rendered/validated in the
   *configured* date format (not the OS-locale native date picker —
   WebKitGTK's date input has no reliable popup) plus a calendar icon
   button opening a themed month-grid popover
   (`src/components/DateCalendar.tsx`, Monday-first, Intl month/weekday
   names, closes on outside click / Escape); picking a day writes the
   display-formatted string back into the input. It is stored as ISO
   `YYYY-MM-DD` after `parseDateToISO()` converts it
   (`src/lib/format.ts`). Brand, color and custom-field-key inputs have `<datalist>`
   autocomplete fed by `getDistinctBrands()` / `getDistinctColors()` /
   `getDistinctCustomKeys()`.
   The FiiO DSP XML encoding used by the import parser: type
   0=PK/1=LSC/2=HSC, freq raw Hz, gain `(raw - 120) / 10` dB, Q
   `raw / 10`, `s` (shelf slope) ignored. Gain offset 120 is **confirmed**
   (user verified against the FiiO app UI: the identical padding bands
   decode to 0 dB). Raw-Hz frequency follows FiiO's own HID protocol
   (fiiocontrol-oss) and both community converters.
4. **Device Detail:** image with lightbox, identity chips, link buttons
   for the manufacturer website / webshop (only shown when set, opened
   via the Tauri opener plugin), tech-spec grid, listening notes, PEQ
   response graph (combined magnitude of the biquad bands, RBJ
   cookbook formulas — `src/lib/peqCurve.ts`, OPRA-styled: fixed ±15 dB
   window, gradient fill, band markers, legend) with the persisted
   `peq_source` attribution line, FR graph with lightbox, extra (custom)
   fields. The device card shows the overall star rating under the name
   plus icon chips (type/driver/color/connector/tube badge) with styled
   field-name tooltips; "The Sound" lists the five rated attributes as
   read-only dot ratings with info popovers. Empty sections (extra, FR,
   PEQ) are hidden when they have no data.
5. **Deletion:** confirm dialog; the device's media files (image + FR
   graph) are removed from `media/` on delete. Replacing an image in the
   form deletes the superseded file on successful save.
6. **Settings:** XDG path display, "open media folder" (system file
   manager), theme (5 selectable dark color schemes, default Tokyo Night),
   language (EN/DE/NL/FR), currency + date format, web-fetch info,
   tube-rule reference, and an About section showing the running app
   version (Tauri `getVersion()`, embedded from tauri.conf.json).

### Phase 2 — Web auto-fetch (implemented)

"Fetch specs" in the add/edit dialog, backed by `src-tauri/src/fetch_specs.rs`
(all HTTP on the Rust side with `reqwest` + `regex`, no webview CSP changes):

1. **squig.link index match.** The main phone book
   (`https://squig.link/data/phone_book.json`) is loaded first (cached 24 h
   under `~/.local/share/audio-vault/cache/`); if no match and the device
   is not an IEM, the `squigsites.json` federation list is consulted and
   every site with a `Headphones`/`Earbuds` db is fetched in parallel
   (cached 7 days). Site URLs follow squig.link's own convention
   (root / subdomain / altDomain / lab folder).
2. **FR curve.** The matched entry's measurement file is fetched
   (`<base><folder>data/<stem> L.txt`, then `R.txt`, then `.txt`),
   parsed as REW text (TSV `freq amp [phase]`, `*` header lines), and
   returned as `[freq, db]` pairs. The frontend renders it to a PNG
   (canvas, log-frequency axis, `src/lib/renderFr.ts`) and stores it in
   `media/` via `media_save_bytes` — `fr_graph_path` stays an ordinary
   image, lightbox unchanged.
3. **Web search + page scraping.** Keyless DuckDuckGo HTML
   (`html.duckduckgo.com`, results arrive as `uddg=` redirect links) —
   no API key needed or stored. Up to 3 result pages are fetched and
   parsed with deliberately lenient heuristics: impedance/sensitivity via
   keyword-window number regexes (Ω/ohm, dB), driver type via an explicit
   "driver/transducer type: X" pattern plus weighted keyword counts,
   product image via `og:image`/`twitter:image` (attribute order
   insensitive, relative URLs resolved against the page).
4. **Orchestration semantics.** `fetch_specs(brand, model, device_type)
   -> FetchedSpecs` never errors on partial failure —
   each step records a human-readable note in `notes`, unfetched fields
   stay `None`. The UI shows a preview (match, FR mini-chart via inline
   SVG, spec chips, notes) and **Apply to form (empty fields only)**;
   apply never overwrites user-entered values, and the product image is
   downloaded via `media_download_image` (https only, image/* content
   type, 5 MB cap) into `media/`.
5. **New commands:** `fetch_specs`, `media_save_bytes` (raw bytes →
   media, collision-safe naming), `media_download_image` (https image →
   media).

### Phase 3 — OPRA preset lookup (implemented, primary PEQ source)

Manual PEQ band entry was removed (too tedious). The PEQ section of the
add/edit dialog is now: **OPRA lookup first, file import as fallback**.

1. **Rust lookup (`src-tauri/src/fetch_opra.rs`).**
   `fetch_opra_presets(brand, model) -> OpraFetchResult`. The OPRA
   database (`database_v1.jsonl`, ~13 MB, 19.5k lines, CC BY-SA 4.0) is
   fetched per their `CONSUMING.md` guidance from the Roon Labs mirror
   (`http://opra.roonlabs.net/database_v1.jsonl`), GitHub `dist/` as
   fallback, cached 24 h under the XDG cache dir, and parsed line-by-line.
   Current wire format is *flat references*: `vendor` entries
   (`id` → `data.name`), `product` entries (`data.vendor_id`, `data.name`,
   `data.subtype`) and standalone `eq` entries (`data.product_id`,
   `data.author`, `data.details`, `data.parameters`). Entries are joined
   in a resolution pass (vendors → products → eq-by-`product_id`); the
   parser also tolerates the legacy nested-profile format. Bands map
   `peak_dip`→PK, `low_shelf`→LSC, `high_shelf`→HSC (`low_pass` and
   out-of-range/non-finite values are dropped). Matching reuses the
   Phase 2 scorers: `brand_score ≥ 0.85` **and** `model_score ≥ 0.6`,
   top 8 candidates. Never errors — problems land in `note` (stale cache,
   network failure), so the UI can distinguish "not found" from "check
   failed".
2. **Frontend flow (`DeviceFormDialog.tsx` + `src/lib/opra.ts`).** On
   brand/model change (400 ms debounce) the dialog invokes
   `fetch_opra_presets`. States: *idle* (no brand/model) → *checking*
   (pulsing hint) → *done*: candidate cards (vendor name, subtype, one
   button per profile `author — details`, band count, overall-gain hint).
   Applying a profile converts it to the stored band model
   (`toPeqBands`, identical RBJ math as OPRA's own graph) and sets
   `form.peq_source` to `OPRA · <author> — <details>` (CC BY-SA
   attribution, persisted in the new `peq_source` column, shown under the
   PEQ graph in the detail view). A non-zero profile `gain_db` is shown
   as a note, never applied (the band model has no global gain). The
   import button is **only** shown when the lookup finds nothing or
   fails (unknown state) — never when candidates are listed.
3. **File import fallback (`src/lib/peqImport.ts`).** `.xml`/`.txt` go to
   the FiiO parser (`parseFiioEq.ts`); `.json` goes to a permissive
   generic parser accepting a bare band array, `{ bands|peq|eq: [...] }`
   (Audio Vault's stored format), and OPRA-style entries — a single `eq`
   entry (attribution captured from `author`/`details`) or a legacy
   product entry with nested profiles (first profile, noted). Key names
   are flexible (`freq|frequency|freq_hz`, `gain|gain_db`, `PK|peak|
   peak_dip`, …); invalid bands are skipped with per-band notes. Parsed
   files are confirmed with a replace box (the manual "append" option is
   gone with the manual rows).
4. **Graph restyle (OPRA look).** `buildPeqSvgModel` now uses a fixed
   ±15 dB window (expanding to clean integer bounds only when the data
   leaves it, 5 dB grid lines, signed labels), a vertical gradient under
   the curve, a dot at every band's (frequency, gain), and a top-left
   `PEQ response · N bands` legend. `buildPeqSvg` (string form) and the
   `PeqGraph` JSX component render the same model; Node-safe (explicit
   theme palette, no CSS variables).

**New/changed commands & columns:** `fetch_opra_presets`; migration v5
adds `devices.peq_source TEXT`.

---

## 🚀 Building on Fedora

```bash
cd app

npm install

# Development mode with hot reload
npm run tauri dev

# Frontend-only typecheck + bundle
npm run build

# Locale key parity across en/de/nl/fr
npm run i18n:check

# Rust checks (in src-tauri/)
cargo check

# Package native deb + RPM installers
# (NO_STRIP=1 required on current Fedora: system libs use RELR sections
#  that linuxdeploy's bundled strip cannot parse. This box has no dpkg-deb,
#  so RPM-only unless `sudo dnf install dpkg-dev` first.)
NO_STRIP=1 npm run tauri build
# → src-tauri/target/release/bundle/rpm/Audio Vault-*.rpm
# → src-tauri/target/release/bundle/deb/audio-vault_*.deb

# Keep shipped bundles OUTSIDE target/ (cargo clean wipes it):
#   cp src-tauri/target/release/bundle/{deb,rpm}/Audio* ../../dist/
# dist/ at the project root is the permanent installer location.
#
# The debug build cache (src-tauri/target/debug) grows to ~14 GB over
# iterations; `cargo clean` in src-tauri reclaims it (first rebuild
# afterwards is cold, ~5–10 min).

# Known quirk: tauri-cli can panic early with "Too many open files"
# (EMFILE) in its file debouncer (notify/inotify). That is the
# per-USER inotify instance ceiling (/proc/sys/fs/inotify/
# max_user_instances, 128), not a real fd limit — other watcher-heavy
# tools (LSPs, analyzers) can push the count over it transiently.
# It clears on its own; just retry the build (a plain `cargo build
# --release` is unaffected).
```

---

## 📝 Implementation Notes

- **Asset protocol:** enabled via the `protocol-asset` Tauri crate feature
  - `app.security.assetProtocol.scope = ["$APPDATA/media/**"]`. Images are
  served as `asset://` URLs via `convertFileSrc`; if the webview fails to
  load one, the UI falls back to a base64 data URL from the
  `media_read_base64` command.
- **Migrations:** the SQL plugin keys migrations by the exact DB URL string,
  so Rust registers migrations for `sqlite:<absolute path>` and the frontend
  loads the same URL (both derived from `init_app_data`).
- **Known tooling quirk:** pi-lens' embedded rust-analyzer reports a false
  E0308 on the `tauri::generate_context!()` call (its proc-macro host
  degrades the expansion to `{unknown}`/`()`). The real compiler
  (`cargo check` / `cargo build`) passes cleanly; the finding is marked
  false-positive. The same fallback parser also false-flags valid `&str`
  range indexing in `fetch_specs.rs` (`reason=fallback`) — likewise
  verified clean by rustc.
- **Phase 2 data sources (verified live, July 2026):** squig.link's main
  phone book is IEM-centric (154 entries); over-ear headphones live in
  federated `Headphones` dbs (e.g. `https://aden.squig.link/headphones/
  data/phone_book.json`). squig.link provides no impedance/sensitivity/
  driver specs — that is what the web-search path is for. The
  `regex` crate does not support backreferences (tag stripping uses
  separate patterns per tag); `reqwest` 0.13 uses the `rustls` feature
  name (not `rustls-tls`) with `default-features = false` + `json`.
