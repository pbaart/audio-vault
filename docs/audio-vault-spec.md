# Audio Vault — Linux (Fedora/RPM) Native Desktop Specification

Audio Vault is a lightweight, local-first Linux desktop application designed for audiophiles to manage headphones, IEMs, frequency response measurement curves, technical specifications, and tube amplifier compatibility.

**License:** MIT — see [LICENSE](../LICENSE). Copyright (c) 2026 pbaart.

---

## 📌 Build Phasing

This project is split into two phases so an AI coding agent can build and validate a working core before tackling the riskiest feature (web scraping).

### Phase 1 — MVP (build first)

- Database schema + CRUD (create/read/update/delete devices)
- All core UI screens (see below)
- Manual data entry for all fields
- Native file picker for images and FR graphs
- Tube compatibility badge logic (rule-based, see below)
- Packaging (RPM/AppImage/deb)

### Phase 2 — Web Auto-Fetch (build after Phase 1 is working and tested)

- "Fetch Specs from Web" scraping/search integration
- Treated as an isolated, separate task so a broken or ToS-risky scraper never blocks the core app from working

---

## 🤖 Agent Working Instructions

These instructions apply to any AI agent working on this codebase, in addition to the spec above.

### Build order (Phase 1)

1. SQLite schema + migration (creates DB at the XDG path on first launch if missing)
2. Rust backend commands for CRUD on `devices` (no UI yet) — verify with a quick manual call or test before moving on
3. Tube compatibility badge logic as a pure function, unit-tested against the rules table above
4. Collection Overview screen (read-only first: list + filter + sort + search)
5. Add/Edit Device dialog, including native file picker wiring and custom-fields row manager
6. Device Detail View + FR graph lightbox
7. Settings screen
8. Packaging (RPM/AppImage/deb) — confirm a build actually produces a working binary

After each step, run `npm run tauri dev` and confirm the app still launches without errors before moving to the next step. Don't stack multiple unverified steps.

### Decision-making

- If a design choice isn't specified in this doc (e.g., exact spacing, a helper library, minor UX wording), pick a reasonable default and note the assumption in a comment or commit message — don't stop and ask.
- If a choice affects the data model, file structure, or Phase 2 scraper approach, stop and ask before proceeding.

### Code conventions

- **Rust:** must be `clippy`-clean; use `Result`/`anyhow` for error handling — no `unwrap()`/`expect()` in code paths that touch the DB, filesystem, or network.
- **TypeScript/React:** functional components + hooks only, no class components; keep Tauri command wrappers (frontend-side `invoke()` calls) in a dedicated `api/` or `commands/` module, not scattered inline in components.
- Keep Rust Tauri commands and frontend code in their existing `src-tauri/` / `src/` split — don't restructure the project layout without asking.

### Testing

- Unit tests required for: tube compatibility badge logic, PEQ JSON parsing, and any DB query helpers that do filtering/sorting.
- No requirement for UI/e2e tests in Phase 1 — manual click-through is sufficient for now.

### Data integrity & error handling

- Sanitize/validate any user-supplied path or filename before writing into `~/.local/share/audio-vault/media/` (no path traversal, no overwriting unrelated files).
- On DB read/write failure: log the error and show a user-facing toast/message — never fail silently.
- Deleting a device must remove its associated media files; if a file is already missing, log and continue rather than throwing.

### Version control

- One commit per logical step in the build order above (not one giant commit, not one commit per file).
- Commit messages should say *what* changed and *why* briefly, e.g. `feat: derive tube_amp_suitable from impedance + driver_type per badge rules`.

---

## 🛠️ Linux Tech Stack & Packaging

- **Desktop Shell:** Tauri v2 (Rust backend utilizing WebKitGTK on Linux)
- **Frontend UI:** React 18+ with TypeScript + Vite + Tailwind CSS (five selectable dark color schemes; Tokyo Night default)
- **Database:** `tauri-plugin-sql` with SQLite
- **File System:** `tauri-plugin-fs` & `tauri-plugin-dialog`
- **Linux Packaging Targets:** `.rpm` (Fedora/RHEL), `.AppImage` (Universal), `.deb` (Debian/Ubuntu)

---

## 🐧 Fedora Dependencies & Setup

To compile and package the app natively on Fedora:

```bash
# Required build dependencies for Fedora
sudo dnf install rpm-build gcc-c++ webkit2gtk4.1-devel openssl-devel
```

In `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "active": true,
    "targets": ["rpm", "appimage"]
  }
}
```

---

## 🖥️ Screens & Navigation (Phase 1)

The app has four primary screens/views:

1. **Collection Overview (default screen on launch)**
   - Grid or list of all devices, showing image thumbnail, brand, model, type, and tube-compatibility badge.
   - Filter controls: by `type` (Over-Ear / On-Ear / IEM / Bone Conduction), by `driver_type`, by `tube_amp_suitable`.
   - Sort controls: by brand, model, price, purchase date, soundstage rating.
   - Search bar: free-text match on brand + model.
   - Empty state: if the database has zero devices, show a "Add your first device" call-to-action instead of an empty grid.

2. **Device Detail View**
   - All fields from the `devices` table, laid out in sections: General info, Technical specs, Sound & fit notes, FR graph, Custom fields.
   - FR graph thumbnail opens the Frequency Response Lightbox (full-screen zoom modal).
   - Edit and Delete actions accessible from this screen.

3. **Add / Edit Device Dialog**
   - Form covering all `devices` columns.
   - In Phase 1, all fields (including image and FR graph) are filled in manually via the native file picker — no auto-fetch button yet.
   - Dynamic key-value row manager for `custom_fields` (add/remove rows freely).
   - Validation: `brand`, `model`, and `type` are required; numeric fields (`impedance_ohms`, `sensitivity_db`, `soundstage_rating`) reject non-numeric input.

4. **Settings**
   - Shows the resolved XDG paths in use (DB, media, config) for transparency/debugging.
   - Option to open the media folder in the system file manager.

### First-Launch Behavior

On first run, if `~/.local/share/audio-vault/collection.db` does not exist, the app creates it, runs the schema migration, and opens directly to the Collection Overview in its empty state.

---

## 🌐 Web Auto-Fetch & Scraping Engine (Phase 2 — build after MVP works)

When adding new gear, users can enter **Brand** and **Model** and click a **"Fetch Specs from Web"** button.

> **Note on approach:** Sites like Head-Fi, RTINGS, and squig.link have no public API, so this requires HTML scraping or a search-API intermediary. Scraping is fragile (breaks on layout changes) and may conflict with a site's terms of service — treat this as an experimental, best-effort feature, not a guaranteed data source. Confirm the specific implementation approach (direct scraping vs. a search API) before an agent starts on this phase.

### Implementation Logic (Rust Backend Command)

1. **Scraper / Search Invocation:** Execute a background search using a light web scraper or web search query (e.g., searching product specs from Head-Fi, RTINGS, squig.link, or manufacturer sites).
2. **Data Extraction:** Automatically parse and populate form fields:
   - `driver_type` (Dynamic, Planar, BA, etc.)
   - `impedance_ohms`
   - `sensitivity_db`
   - `image_path` (Auto-download product image into local media folder)
   - `fr_graph_path` (Auto-fetch measurement curve image if available on squig.link/Crinacle)
3. **Manual Override:** All auto-fetched fields populate as editable form inputs so the user can review and adjust them before saving.
4. **Failure handling:** if no match is found or a field can't be parsed, leave that field blank rather than guessing — the user fills it in manually.

---

## 📂 Linux XDG File Paths

The app strictly follows the Linux XDG Base Directory Specification:

- **Database Path:** `~/.local/share/audio-vault/collection.db`
- **Media/Images Path:** `~/.local/share/audio-vault/media/`
- **Config Path:** `~/.config/audio-vault/config.json`

---

## 🗄️ Database Schema (`devices` table)

```sql
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,                    -- Brand / Manufacturer (e.g., "Sennheiser", "Moondrop")
  model TEXT NOT NULL,                    -- Model Name (e.g., "HD600", "Blessing 3")
  type TEXT NOT NULL,                     -- 'Over-Ear' | 'On-Ear' | 'IEM' | 'Bone Conduction'
  color TEXT,                             -- Free text, e.g. 'Midnight Blue' (autocomplete from existing values)
  ownership_status TEXT,                  -- 'owned' | 'sold' | 'not_in_use' | 'loaned'; NULL = not marked (both categories)
  manufacturer_url TEXT,                  -- Optional http(s) link to the manufacturer's website
  webshop_url TEXT,                       -- Optional http(s) link to the webshop where it was bought
  image_path TEXT,                        -- Relative path in ~/.local/share/audio-vault/media/
  price REAL,                             -- EUR/USD
  purchase_date TEXT,                     -- ISO 'YYYY-MM-DD'
  driver_type TEXT,                       -- 'Dynamic' | 'Planar' | 'BA' | 'Electrostatic' | 'Hybrid' | 'Tribrid'
  impedance_ohms INTEGER,                 -- Nominal impedance (Ω)
  sensitivity_db REAL,                    -- Sensitivity (dB/mW or dB/V)
  connector_type TEXT,                    -- amp-side plug, e.g. "3.5mm jack", "4.4mm Pentaconn", "XLR"
  tube_amp_suitable TEXT,                 -- 'Yes' | 'No' | 'OTL Only' | 'Transformer Only' (derived, see Tube Compatibility Rules)
  drive_difficulty TEXT,                  -- 'Easy' | 'Moderate' | 'Demanding'
  sound_signature TEXT,                   -- 'Neutral' | 'Warm' | 'V-Shaped' | 'Bright' | 'Harman' | 'Dark'
  soundstage_rating INTEGER,              -- Scale 1-5
  listening_notes TEXT,                   -- Personal impressions & eartip/pad choices
  fr_graph_path TEXT,                     -- Relative path to measurement graph image
  peq_settings TEXT,                      -- Parametric EQ profile, JSON array (see PEQ Settings Format)
  peq_source TEXT,                        -- Provenance of the PEQ bands (OPRA preset / imported file)
  custom_fields TEXT,                     -- Serialized JSON string for dynamic key-value pairs
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### PEQ Settings Format

`peq_settings` stores a JSON array of parametric EQ bands, in AutoEQ-compatible shape:

```json
[
  { "type": "PK", "freq_hz": 105, "gain_db": -3.2, "q": 0.9 },
  { "type": "PK", "freq_hz": 2800, "gain_db": 2.1, "q": 1.4 },
  { "type": "LSC", "freq_hz": 105, "gain_db": -3.2, "q": 0.7 }
]
```

- `type`: filter type — `PK` (peaking), `LSC` (low shelf), `HSC` (high shelf).
- `freq_hz`: center/corner frequency in Hz.
- `gain_db`: gain in dB (negative = cut, positive = boost).
- `q`: Q factor of the filter.
- Empty/no EQ profile is stored as `"[]"`, not `NULL`, so the UI can always safely parse it.

### OPRA preset lookup (primary PEQ source)

Bands are no longer entered by hand (too tedious). The add/edit dialog
looks up the device in [OPRA](https://opra.roon.app) — a community
database of measured/curated EQ presets (AutoEQ, oratory1990,
Rtings/AutoEQ, …), licensed CC BY-SA 4.0 — as soon as brand + model are
entered (debounced):

- **Backend** (`src-tauri/src/fetch_opra.rs`, command
  `fetch_opra_presets`): the `database_v1.jsonl` dump (~13 MB) is
  downloaded from the official Roon Labs mirror (GitHub `dist/`
  fallback) per OPRA's `CONSUMING.md` personal-use guidance, cached 24 h
  under `~/.local/share/audio-vault/cache/`, and parsed line-by-line.
  Current wire format: `vendor` entries (id → display name), `product`
  entries (`vendor_id`, name, subtype) and standalone `eq` entries
  (`product_id`, author, details, parameters), joined in a resolution
  pass (the legacy nested-profile format is still tolerated).
  Matching reuses the web-fetch scorers: brand score ≥ 0.85 **and**
  model score ≥ 0.6, top 8 candidates. The command never errors —
  network/cache problems land in `note`, so the UI can distinguish "not
  found" (import allowed) from "lookup failed" (import still allowed,
  warning shown).
- **Applying a preset** converts the profile to the stored band model
  (PK/LSC/HSC — same RBJ biquad math as OPRA's own graph) and persists
  the attribution string `OPRA · <author> — <preset name>` in the
  `peq_source` column (shown under the PEQ graph in the detail view —
  CC BY-SA requires keeping the source). A profile-level overall gain is
  surfaced as a note only; the band model has no global gain.
- **Band mapping:** `peak_dip`→PK, `low_shelf`→LSC, `high_shelf`→HSC;
  `low_pass` bands and out-of-range (1–20 kHz) / non-finite values are
  dropped.

### PEQ file import (fallback when OPRA has no match)

The import button is only offered when the OPRA lookup finds nothing (or
fails). It accepts `.xml` / `.txt` (FiiO DSP exports) and `.json`:

- **FiiO DSP XML** (`src/lib/parseFiioEq.ts`): `FiiO_DSP` →
  `module/eq` → `eqGroup` → `eqList` → `eq` elements with `<param
  name=...>` children. Official app encoding: `type` 0=PK, 1=LSC, 2=HSC;
  `freq` in Hz; `gain` decoded as `(raw − 120) / 10` dB; `q` decoded as
  `raw / 10`; `s` (shelf slope) is ignored. Long identical tail runs are
  flagged as likely app padding.
- **Generic JSON** (`src/lib/peqImport.ts`): a bare band array, or an
  object with `bands` / `peq` / `eq` array (Audio Vault's stored format),
  or an OPRA-style entry — a single `eq` entry (attribution captured
  from `author`/`details`) or a legacy product entry with nested profiles
  (first profile, noted). Key names are permissive (`freq`/
  `frequency`/`freq_hz`, `gain`/`gain_db`, `PK`/`peak`/`peak_dip`, …);
  invalid bands are skipped with per-band notes.
- Either way, the user confirms a **replace** box before the bands touch
  the form; parsed files also set `peq_source` (file name, or the file's
  own attribution when it carries one).

Bands from either path are validated (1–20000 Hz, finite gain; Q ≤ 0
falls back to 0.707 with a note).

### PEQ response graph

The device detail view renders the PEQ bands as a combined
magnitude-response graph — styled after opra.roon.app — instead of a band
table: log-frequency axis (20 Hz – 20 kHz), a fixed ±15 dB window
(expanding to clean integer bounds only when a band's gain leaves it, 5 dB
grid lines, signed labels), a gradient fill under the curve, a dot at
every band's (frequency, gain), and a `PEQ response · N bands` legend,
all in the active theme colors. A compact summary line follows (e.g.
`31 bands: HSC ×1 · LSC ×1 · PK ×29`), plus the persisted
`peq_source` attribution. The curve is computed in `src/lib/peqCurve.ts`
from RBJ Audio-EQ-Cookbook biquad formulas: each band is a second-order
IIR filter evaluated on a log-spaced grid, and the bands cascade — the
total gain in dB at each frequency is the sum of the per-band dB
responses (exactly how the hardware applies them, and how OPRA renders
the same bands).

---

## ⚙️ Tube Compatibility Badge Rules

`tube_amp_suitable` is **derived automatically** from `impedance_ohms` and `driver_type` (not manually set), using these thresholds:

| Condition | Stored value | Shown in UI |
| --- | --- | --- |
| `impedance_ohms >= 120` | `Yes` | Perfect Match |
| `impedance_ohms >= 32 AND impedance_ohms < 120` AND `driver_type = 'Dynamic'` | `OTL Only` | Limited Compatibility |
| `impedance_ohms >= 32 AND impedance_ohms < 120` AND `driver_type IN ('Planar','BA','Electrostatic','Hybrid','Tribrid')` | `Transformer Only` | Not Recommended |
| `impedance_ohms < 32` | `No` | Not Supported |
| `impedance_ohms IS NULL` | *(none)* | *(no badge shown — insufficient data)* |

This logic runs whenever a device is saved (add or edit) and recalculates `tube_amp_suitable`; the form also offers a manual per-device override. The database stores the short codes above, and the UI renders the friendlier display names via `TUBE_BADGE_LABELS` (src/types.ts) — so existing collections need no migration when display names change.

---

## ⚙️ Core UI & Data Management

1. **Brand & Model UI Separation + Web Fetch Button:** Inputs for Brand and Model with a dedicated `Auto-Fetch Specs` button (Phase 2 — hidden/disabled in Phase 1 builds).
2. **Integrated Admin Controls:** Directly add, edit, or delete entries via UI dialogs. Deleting cleans up associated local media files (image + FR graph) from `~/.local/share/audio-vault/media/`.
3. **Dynamic Custom Fields (`custom_fields TEXT`):** Dynamic key-value row manager (`[{ key: string, value: string }]`) saved as JSON to record custom metadata (e.g., *Cable Termination*, *Eartip Model*, *Serial Number*, *Mods*).
4. **Native Linux File Picker:** Selecting images opens native `xdg-desktop-portal` file choosers, copying selected files directly into `~/.local/share/audio-vault/media/`.
5. **Frequency Response Lightbox:** Full-screen zoom modal for graph inspection.
6. **Tube Compatibility Indicators:** Automatic status badges per the rules table above.
7. **Ownership Status:** Per-item status field (both categories) in the form's Basic section — *Owned*, *Sold*, *Not in use* or *Loaned out* (empty = not marked). Shown as a chip on collection cards (non-owned statuses only — owned is the default) and in the detail view's identity chips; the table view has a Status column.

---

## 🚀 Building on Fedora

```bash
# Development mode with Hot-Reload
npm run tauri dev

# Package native RPM & AppImage installers
npm run tauri build

# Output RPM binary located at:
# src-tauri/target/release/bundle/rpm/audio-vault-*.x86_64.rpm
```
