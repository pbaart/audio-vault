# OPRA Integration Plan

**Goal:** make OPRA the **primary** PEQ source — fetch curated presets by brand +
model via the [OPRA](https://github.com/opra-project/OPRA) database, replacing the
tedious manual PEQ input (file import remains as a fallback, **only when the device
is not found in OPRA**) — and restyle the PEQ graph to match the look of
<https://opra.roon.app>.

Status: **proposed — not yet implemented.** Research verified live on 2026-08-21.

---

## 1. Research findings (verified)

### 1.1 The database

- Official mirror for non-commercial use (per `docs/CONSUMING.md`):
  `http://opra.roonlabs.net/database_v1.jsonl` — Roon Labs, Cloudflare-cached, ≤5 min stale.
  Measured: **HTTP 200, 12.64 MB, 19,538 lines.**
- Fallback (allowed, "up-to-the-minute"): `https://raw.githubusercontent.com/opra-project/OPRA/main/dist/database_v1.jsonl`
  — verified identical size; `dist/` is committed after every repo commit.
- Format: JSONL, one object per line, three entry types:

  ```json
  {"type":"vendor","id":"sennheiser","data":{...}}
  {"type":"product","id":"kiiboom::evoke","data":{...}}
  {"type":"eq","id":"kiiboom:evoke::autoeq_hi_end_portable","data":{...}}
  ```

  `eq` entries carry an explicit `product_id` (so joins never depend on id-format
  evolution), and product entries carry an explicit `vendor_id`.

- **Coverage (measured from live dump):**

  | metric | value |
  | --- | --- |
  | vendors | 714 |
  | products | 6,230 (6,229 have ≥1 EQ; avg 2.0, max 34 per product) |
  | EQ profiles | 12,594 |
  | subtypes | in_ear 3,933 · over_the_ear 2,167 · earbuds 126 · on_ear 4 |
  | band types | peak_dip 97,887 · low_shelf 12,501 · high_shelf 12,479 · **low_pass 5** (nothing else) |
  | top authors | AutoEQ 10,784 · oratory1990 1,342 · Rtings/AutoEQ 468 |
  | FiiO | 85 products |

  → IEMs are well covered; **99.99 % of all bands map to our PK/LSC/HSC model.**

- Product entries also ship `line_art_svg` + `line_art_96x64_png` asset paths
  (served at `http://opra.roonlabs.net/<path>`, verified 200).

### 1.2 The website's graph (decompiled from the SPA bundle)

`EqCurve` component (Vue) defaults:

- **SVG**, 600×250, margins L20/T45/R20/B20
- **Log frequency axis 20 Hz – 20 kHz**; zoom presets Full / Bass (20–300) / Mids (200–5k) / Treble
- **Linear dB axis −15 … +15**, grid with a subtle gradient fill
- **Multiple profiles overlaid**, each in a distinct color from a 12-color palette
  (violet #967CCB, roon #7574F3, cyan #3D9FB3, green #9DC17B, amber #E6B952, red #D14861, …)
- **Band markers**: a dot at every band's center frequency on the curve (`showMarkers` default on)
- **Legend** with per-profile toggle
- Freq labels: `20Hz … 1kHz … 10kHz` (1 decimal for 10 kHz+); dB labels signed 1 decimal (`+3.0`)
- **Math is the RBJ Audio-EQ-Cookbook biquads at FS = 48 000 — identical to what we already
  implement in `peqCurve.ts`** (verified coefficient-for-coefficient), with a −15 dB display floor.

**Conclusion:** we do *not* need to change or replace our curve math at all. The OPRA
difference is (a) a *curated data source* and (b) *visual language* (grid, markers,
labels, range, legend).

### 1.3 Licensing

- Data: **CC BY-SA 4.0**. Non-commercial/personal use → use the Roon Labs mirror
  (their stated guideline). We never ship or redistribute the DB (runtime fetch +
  local cache), which is what their consumer guidance describes.
- **Attribution is mandatory** when presenting presets: credit the *preset author*
  (ideally more prominently than OPRA) plus a link to the OPRA project. → We need to
  persist per-device PEQ provenance (see §4.5).

---

## 2. Design decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | OPRA is the **primary** PEQ source; **manual PEQ band entry is removed** from the form | Fetch by brand + model is the main flow (per user: manual band entry is too tedious). File import (XML/JSON) becomes the fallback, shown only when the device is not found in OPRA. |
| D2 | Keep our `peqCurve.ts` math and `PeqGraph` component; **restyle + extend** it | Math is already identical to OPRA's; only the visual layer changes. |
| D3 | Band-type mapping: `peak_dip→PK`, `low_shelf→LSC`, `high_shelf→HSC`; anything else **skipped with a note** | Only 5 `low_pass` bands exist in the entire DB. Same skip-with-note semantics as FiiO import. |
| D4 | Profile-level `gain_db` (overall gain): **not applied, surfaced as a note** | Our `PeqBand[]` model has no global-gain field; most presets are 0, AutoEQ ones often −3…−4. Note: "profile has −4 dB overall gain (not applied)". |
| D5 | Import **all** bands (no truncation to hardware band counts) | Audio Vault stores settings for reference; hardware band limits are an export-time concern. A preset is replaced as a whole (Clear PEQ / Apply another profile). |
| D6 | Matching **never auto-applies**: fetch returns up to N candidate products; user picks profile in a picker | Model-name variants are common; mirrors the "Apply to form (empty fields only)" caution of Phase 2. |
| D7 | Cache the 12.6 MB JSONL under the XDG cache dir with a **24 h TTL** (re-check ETag/Last-Modified, fall back to age) | Same caching pattern as the squig.link phone book; desktop app, daily freshness is plenty; keeps offline use working. |
| D8 | New optional DB column **`peq_source`** (migration v5) storing provenance, e.g. `"OPRA · AutoEQ — Harman Target"` | CC BY-SA author attribution must persist with the preset. Small, nullable, zero impact on existing rows. |
| D9 | Graph restyle keeps **theme-driven colors** (app palette), adopts OPRA's layout: ±15 dB base range (auto-expand beyond), Hz/kHz labels, signed dB labels, grid + under-curve gradient, **band markers**, legend line | Consistency with the 5 themes beats copying OPRA's fixed 12-color palette (which exists for multi-profile overlays; we show one stored preset). |
| D10 | Zoom presets (Full/Bass/Mids/Treble) are **optional v1.1** | OPRA ships them hidden by default; cheap to add later in the same component. |
| D11 | **Auto-check OPRA on dialog open** (and on brand/model change, debounced), best-effort and cache-backed; the section shows checking / found / not-found / unknown states | Makes the fallback gating automatic — no "did I fetch?" ambiguity; after the first 12.6 MB download, checks are local (Rust-side parse of the cached JSONL). |
| D12 | Import button becomes **"Import XML/JSON"** (existing FiiO XML parser + new generic JSON parser), visible **only in not-found (and unknown) states** | Exactly the requested fallback; JSON accepts OPRA-style entries, bare band arrays, and our stored format (flexible key names). |
| D13 | Apply is **Apply (replace) / Cancel** — Append is dropped; a **Clear PEQ** button removes stored bands + source | With manual entry gone, Append has no sensible use; Clear keeps previously imported presets manageable (also the only way to remove old hand-entered bands). |

---

## 3. Architecture

### 3.1 Rust — new module `app/src-tauri/src/fetch_opra.rs`

Mirrors the `fetch_specs.rs` patterns (reqwest + rustls, static best-effort,
never errors, tests in-module).

1. **`OpraProfile` struct** — compact, testable:
   `product { vendor_id, name, subtype }`, `author`, `details`, `link`,
   `overall_gain_db`, `bands: Vec<OpraBand { kind: u8, freq: f32, gain: f32, q: f32 }>`.
2. **`load_database()`** —
   - cache file `~/.local/share/audio-vault/cache/opra/database_v1.jsonl` (+ sidecar
     `meta.json` with `fetched_at`);
   - fresh if missing or > 24 h;
   - GET primary `http://opra.roonlabs.net/database_v1.jsonl`, on failure
     `https://raw.githubusercontent.com/opra-project/OPRA/main/dist/database_v1.jsonl`;
   - stream-parse JSONL with `serde_json::from_str` per line (19.5 k lines ≪ 100 ms);
   - build `index: Vec<(vendor_norm, name_norm, Vec<OpraProfile>)>` plus product list.
3. **`match_products(brand, model)`** — reuse the normalization helpers from
   `fetch_specs.rs` (lowercase, strip non-alphanumerics):
   - exact `(vendor, name)` norm-equality first,
   - then name containment / model-token scoring,
   - return up to **8 candidates** with their profiles (author, details, link,
     overall gain, band count, band types).
4. **Tauri command `fetch_opra_presets(brand: String, model: String) -> Vec<OpraCandidate>`** —
   best-effort: network/parse failure → `Vec::new()` + optional `note` field, never `Err`.
5. **Unit tests** (module-local, like `fetch_specs.rs`):
   - JSONL parse of a synthetic 3-entry file (vendor/product/eq),
   - id-join robustness (eq→product via `product_id`, product→vendor via `vendor_id`),
   - matching: case, punctuation, model variants, no-match,
   - band mapping incl. skip+note for `low_pass`,
   - overall-gain note generation,
   - cache path + TTL logic (injectable now/fetch-time).

`lib.rs`: register command; no config changes. `Cargo.toml`: nothing new (reqwest,
serde_json, regex, tokio already present).

### 3.2 Frontend — data path (OPRA primary, import fallback)

1. **`src/lib/opra.ts`** — TS types (`OpraCandidate`, `OpraProfileInfo`), wrapper
   `fetchOpraPresets(brand, model)` over `invoke("fetch_opra_presets")`, and
   `toPeqBands(profile): { bands: PeqBand[], notes: string[] }` (skipped-band and
   overall-gain notes, same semantics as the FiiO path).
2. **`src/lib/peqImport.ts`** (new) — file dispatch for the fallback import:
   - `.xml` → existing FiiO parser (`parseFiioEq.ts` unchanged);
   - `.json` → new generic parser accepting: an OPRA eq entry
     (`{"parameters":{"gain_db":0,"bands":[…]}}`), a bare band array, or our stored
     format; flexible keys (`freq|frequency|freq_hz`, `gain|gain_db`, and
     `PK|peak|peak_dip|LSC|LS|low_shelf|HSC|HS|high_shelf`); unsupported band types
     skipped with a note; overall `gain_db` noted, not applied.
3. **`DeviceFormDialog.tsx` — PEQ section redesigned** (the tedium-killer):
   - **Manual band table removed** ("Add PEQ band" rows + inline band editing
     deleted; `FormState.peq` remains internally).
   - **Auto OPRA check** on open and on brand/model change (debounced ~500 ms),
     best-effort. Section states:
     - *checking* — spinner line ("Checking OPRA…");
     - *found* — candidate product rows (product, vendor, subtype) each with its
       profile list (author, details, band count, overall-gain badge if ≠ 0);
       selecting a profile → **Apply / Cancel**; Apply replaces `form.peq`, sets
       `form.peq_source = "OPRA · <author> — <details>"`, and shows notes
       (skipped bands, overall gain) in the result line;
     - *not found* — "No OPRA profiles for <brand> <model>" + **"Import XML/JSON"**
       button (native file picker → `peqImport` → notes + **Apply / Cancel**);
     - *unknown (network/parse failure)* — same as not-found plus a warning line
       ("OPRA check failed — import still available"); never blocks saving.
   - **Clear PEQ** button (visible when bands are present): empties bands +
     `peq_source`.
   - Attribution line: "EQ profiles from [OPRA](https://github.com/opra-project/OPRA),
     CC BY-SA" (always visible in the PEQ section).
4. **`src/types.ts` / `db.ts`** — `Device.peq_source: string | null`;
   insert/update SQL extended; `rowToDevice`/`saveDevice` wire it through.

### 3.3 Frontend — graph restyle (the "like opra.roon.app" part)

`PeqGraph.tsx` / `peqCurve.ts` (component + model only — math untouched):

- **Range**: fixed ±15 dB baseline; auto-expand to `max(15, ceil(max|curve|)+1)` if
  the preset exceeds it (OPRA is fixed ±15; our FiiO imports can legitimately go beyond).
- **Axes**: log freq 20 Hz–20 kHz, decade + 2/5 subgridlines; labels `20Hz 100Hz
  1kHz 10kHz 20kHz` (OPRA's exact formatting); y labels signed 1 decimal at 5 dB steps.
- **Grid**: thin gridlines + soft gradient under the curve (OPRA's `gridGradient` look),
  all colors from `chartPalette()` so all 5 themes keep working.
- **Band markers**: dot at each band's `(freq, curve(freq))` — the signature OPRA detail
  (`showMarkers` equivalent, always on).
- **Legend line**: `PEQ · <n> bands · <peq_source>` (author attribution visible right on
  the graph → satisfies CC BY-SA prominence).
- **`buildPeqSvgModel`** gains: gridline list, axis labels, marker points, legend text —
  still a pure data model (keeps the Node-test story; no CSS var reads in Node).
- Device Detail: the existing large PEQ panel shows the restyled graph; no layout change.
- Optional (D10, v1.1): zoom preset buttons (Full/Bass/Mids/Treble) — pure view state.

---

## 4. File-by-file change list

| file | change |
| --- | --- |
| `src-tauri/src/fetch_opra.rs` | **new**: download, cache, JSONL parse, matching, command, tests |
| `src-tauri/src/lib.rs` | register `fetch_opra_presets`; migration **v5** `ALTER TABLE devices ADD COLUMN peq_source TEXT;` |
| `src/types.ts` | `peq_source: string \| null` on `Device` |
| `src/lib/db.ts` | insert/update/row mapping for `peq_source` |
| `src/lib/opra.ts` | **new**: types, `fetchOpraPresets`, `toPeqBands` |
| `src/lib/peqImport.ts` | **new**: file dispatch — `.xml` → FiiO parser, `.json` → generic/OPRA-style parser (flexible keys, skip+note, overall-gain note) |
| `src/components/DeviceFormDialog.tsx` | PEQ section redesign: manual band table **removed**; auto OPRA check (checking/found/not-found/unknown states); profile picker + Apply/Cancel; fallback "Import XML/JSON" (not-found/unknown only); Clear PEQ; `peq_source` in form state + save payload |
| `src/components/DeviceDetailView.tsx` | attribution chip when `peq_source` set |
| `src/components/PeqGraph.tsx`, `src/lib/peqCurve.ts` | OPRA-style restyle (axes/grid/markers/legend/±15 dB), `buildPeqSvgModel` extension |
| `README.md`, `AGENT.md`, `audio-vault-spec.md` | feature + data-source + attribution + caching docs |

---

## 5. Edge cases & risks

| item | handling |
| --- | --- |
| Mirror down | GitHub `dist/` fallback (verified serving byte-identical file) |
| No match for device | "not found" state — fallback **Import XML/JSON** button appears (Phase-2 best-effort semantics; saving is never blocked) |
| Brand/model edited after a match | debounced re-check; an applied profile stays in the form until replaced or cleared |
| OPRA check fails (network/parse) | "unknown" state — import still available with a warning line; the form degrades to the pre-OPRA behavior (import only, no manual entry) |
| Same product, many profiles (max 34 seen) | picker lists all, default-sorted: AutoEQ first, then by author |
| Unsupported band (`low_pass`, 5 in whole DB) | skipped + counted in notes |
| Overall gain ≠ 0 | noted, not applied (D4) |
| Brand/vendor aliasing ("SENNHEISER" vs `sennheiser`) | normalization; containment fallback; user always picks |
| DB growth to 50k entries | streaming per-line parse, no whole-file JSON; still trivial |
| Memory | 12.6 MB file → tens of MB parsed, on-demand, released after command |
| License | non-commercial mirror per CONSUMING.md; author + OPRA attribution persisted (`peq_source`) and shown on graph/panel |
| Offline | cached JSONL keeps matching working until TTL expiry; no match ≠ error |
| Existing devices with old manual/FiiO bands | bands remain stored and graphed; the form can only **Clear** or **Replace** them (manual editing intentionally removed) |

---

## 6. Phasing & effort

| phase | scope | est. |
| --- | --- | --- |
| **A — data** | `fetch_opra.rs` (download/cache/parse/match/command) + unit tests + `cargo test` green | ~1 day |
| **B — fetch UI** | `lib/opra.ts` + `lib/peqImport.ts`; dialog PEQ redesign (manual editor **removed**, auto-check states, profile picker + Apply, XML/JSON fallback import, Clear PEQ) + `peq_source` (migration v5) + `tsc`/`vite` green | ~0.75 day |
| **C — graph** | `PeqGraph`/`peqCurve` OPRA restyle + markers + legend + Node test updates | ~0.5 day |
| **D — ship** | docs (README/AGENT/spec), attribution review, RPM + AppImage rebuild | ~2 h |

Zoom presets (D10) and product line-art thumbnails in the picker are explicit
**v1.1 candidates**, not in the base scope.

## 7. What is deliberately *not* done

- **No scraping of opra.roon.app** — the JSONL mirror is the official, documented,
  more reliable source (scraping a SPA would be strictly worse).
- **No change to PEQ math** — already identical to OPRA's implementation.
- **No manual PEQ band input** — removed per user request; OPRA fetch is the primary
  path, file import (XML/JSON) the fallback for devices not in OPRA (D1/D12/D13).
- **No FR-curve integration** — OPRA ships no measurement data; squig.link Phase 2
  remains the FR source. (Future: overlaying FR + applied EQ in one graph would be a
  separate, larger feature.)
- **No global-gain support in the storage model** — noted instead (D4).
