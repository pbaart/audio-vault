# Audio Vault — Multilingual (i18n) Plan

**Languages:** English (source), German, Dutch, French — all LTR, no RTL/CJK layout work.
**Scope:** All UI strings + Rust-generated messages (spec fetch, OPRA, PEQ import notes/errors).

## Architecture

### 1. Library: `i18next` + `react-i18next`

Standard, small, handles plurals (DE/NL/FR differ from EN), interpolation, and
fallback to EN for missing keys. No RTL/CJK concerns for our four languages.

- Catalogs: `app/src/locales/{en,de,nl,fr}.json` (one file per language, nested keys)
- Init module: `app/src/lib/i18n.ts`, imported once in `main.tsx`
- Components use `const { t } = useTranslation()`
- `fallbackLng: "en"`, `interpolation: { escapeValue: false }` (React escapes)

### 2. Language selection & persistence

- Add `language: "en" | "de" | "nl" | "fr"` to:
  - `AppSettings` in `src/lib/settings.ts` (+ `DEFAULT_SETTINGS.language = "en"`)
  - `AppConfig` in `src-tauri/src/lib.rs` — safe: the struct already uses
    `#[serde(default)]`, so old `config.json` files keep working
- **First launch:** detect from `navigator.language` (prefix match `de-*`, `nl-*`,
  `fr-*`), fall back to `en`. No extra dependency needed.
- **Settings UI:** language dropdown in `SettingsView` with native names
  (English, Deutsch, Nederlands, Français). On change: `i18n.changeLanguage(lang)`
  + persist via existing `updateSettings` (optimistic update + revert already works).

### 3. Rust messages → localized in the frontend

Rust emits **stable codes** (no free text) so the frontend owns all
translations (single source of truth). Two helpers in `lib.rs`:

- `note(code)` — a code with no parameters, e.g. `spec.no_match_iem`
- `note_with(code, params)` — a code + a JSON array of positional params,
  e.g. `spec.search_failed:["reqwest error …"]`

The wire shape stays `notes: Vec<String>` / `note: Option<String>`. The
frontend helper `localizeNote(note)` in `src/lib/i18n.ts`:
- splits `code` from the optional `:[json array]`
- looks up the `notes.<code>` key, mapping array items to `{{p0}}`, `{{p1}}`, …
- unknown code → shown as-is (forward compatibility with older Rust builds)

Frontend-generated notes (`peqImport.ts`, `opra.ts`, `parseFiioEq.ts`) call
`i18n.t()` directly at generation time (they're TS, no code indirection needed).
Display sites (App error screen, form notes/errors, settings folder error) run
everything through `localizeNote()`.

### 4. Locale-aware formatting

- Prices: `formatPrice(value, currency, locale)` uses
  `Intl.NumberFormat(locale, { style: "currency", currency })` in
  `src/lib/format.ts`; `locale` comes from `localeFor(settings.language)`
  (`de-DE`, `nl-NL`, `fr-FR`, `en-GB`). Formatter cache is keyed by
  `locale:currency`.
- `currencySymbol(currency)` for the price field label (real symbol, not a
  hardcoded €)
- Dates: existing `dateFormat` patterns are digit-based (locale-neutral) — no change
- Hz / Ω / dB are universal units — kept as-is

## Key structure (as implemented)

247 keys per catalog, identical structure across all four languages.
Top-level namespaces:

```jsonc
{
  "app":        { "title", "loading", "error" },
  "nav":        { "collection", "settings" },
  "actions":    { "addDevice" },
  "common":     { "cancel", "delete", "edit", "close", "closeViewer", "bands_one/other" },
  "delete":     { "title", "confirm", "mediaNote", "unundoable" },
  "lightbox":   { "unavailable", "image" },
  "tube":       { "tooltip", "badges": { "Yes", "OTL Only", "Transformer Only", "No" } },
  "tubeRule":   { "high", "dynamic", "nonDynamic", "low", "unknown" },
  "peq":        { "axisTitle" },
  "values":     { /* stored enum values: device type, driver, connector, … */ },
  "fields":     { "brand", "model", "type", "driver", "impedance", "…" },
  "collection": { "empty", "search", "filter", "sort", "view", "count_one/other", "…" },
  "detail":     { "zoom", "device", "connectorLabel", "specs", "notes", "peq", "fr", "…" },
  "form":       { /* all DeviceFormDialog labels, placeholders, validation.* */ },
  "notes":      { "common", "spec", "opra", "err" },   /* Rust note codes */
  "peqImport":  { /* frontend PEQ-import notes */ },
  "opraNote":   { "overallGainNotApplied" },
  "fiioeq":     { /* FiiO XML parser notes */ },
  "settings":   { "title", "preferences", "language", "theme", "storage", "about", "…" }
}
```

Plural keys use i18next `_one` / `_other` suffixes (`collection.count`,
`common.bands`, `form.peqLoaded`).

## Phases

> **Status: ALL PHASES COMPLETE.** All five phases are implemented, the full
> app builds (release binary + RPM), and `npm run i18n:check` passes
> (247 keys × 4 languages, 198 source keys, 18 Rust note codes all mapped).
> Known deferral: text baked into generated FR/PEQ images ("Frequency (Hz)"
> axis label in renderFr/peqCurve SVG output) stays English — translating it
> would require regenerating stored images.

### Phase 0 — Setup ✅
- `npm i i18next react-i18next`
- `src/lib/i18n.ts` (init, `localizeNote`, locale helper), import in `main.tsx`
- `language` field in `AppSettings` + Rust `AppConfig` + `DEFAULT_SETTINGS`
- Language dropdown in `SettingsView`
- EN catalog with the shell strings (App.tsx) as the first extraction pass

### Phase 1 — Shell & small components ✅
- `App.tsx` (nav, add-device button, delete modal, error/loading screens)
- `Modal`, `Lightbox`, `TubeBadge`, `PeqGraph` (`FrPreview`/`MediaImage` have no
  translatable strings — axis labels are universal units)
- Interpolation: delete confirmation with `{{name}}` as a styled React node
- `TUBE_BADGE_LABELS` removed from `types.ts`; labels now via `tube.badges.*`
  keys + `tubeBadgeLabel()` helper; `describeTubeRule(t)` takes a translate fn
  (DeviceFormDialog call sites updated minimally, full migration in Phase 2)

### Phase 2 — Big views (bulk of the work) ✅
- `CollectionView.tsx` (463 lines): headers, empty state, sort, badges
- `DeviceDetailView.tsx` (335 lines): section titles, field labels
- `DeviceFormDialog.tsx` (1326 lines — the big one): all labels, tabs,
  validation messages, hints
- `SettingsView.tsx`: remaining labels
- Stored enum values (device type, driver, connector, …) localized via
  `values.*` keys + `enumLabel()` helper (dot-containing values like
  "3.5mm jack" use underscored keys); `summarizePeq(bands, t)` and
  `validate(form, t)` take a translate fn; `currencySymbol()` for the
  price label

### Phase 3 — Rust message codes ✅
- Audited all user-visible strings in `fetch_specs.rs`, `fetch_opra.rs`, `lib.rs`
- Replaced free text with stable codes via `note(code)` / `note_with(code, json)`
  (18 distinct codes; `notes: Vec<String>` wire shape unchanged)
- `localizeNote()` maps `code` / `code:[json array]` → `notes.<code>` with
  `{{p0}}`, `{{p1}}`, … interpolation; unknown codes render as-is
- Frontend-generated notes (`peqImport.ts`, `opra.ts`, `parseFiioEq.ts`) now
  call `i18n.t()` directly at generation time
- Display sites (App error screen, form notes/errors, settings folder error)
  run everything through `localizeNote()`
- `notes.*` keys added to all four catalogs

### Phase 4 — Locale-aware formatting ✅
- `formatPrice(value, currency, locale)` uses `Intl.NumberFormat` per locale;
  `localeFor(settings.language)` supplies `de-DE` / `nl-NL` / `fr-FR` / `en-GB`
- `currencySymbol()` for the price field label
- Hz / Ω / dB are universal units — kept as-is

### Phase 5 — Quality & tooling ✅
- `scripts/i18n-check.mjs` → `npm run i18n:check`: verifies (1) all four
  catalogs have identical key structure, (2) every static `t("…")` key used in
  source exists in en.json (plural base keys match `_one`/`_other`), (3) every
  Rust `note()`/`note_with()` code has a `notes.*` key, (4) reports unused keys
- Plurals handled via i18next `_one`/`_other` (DE/NL/FR rules incl. FR 0/1)
- Manual QA: switch through all 4 languages on every screen (pending user pass)

## Risks & notes

- **Translation quality:** DE/NL/FR are AI-drafted — a native speaker should
  review before release
- **Backward compat:** `#[serde(default)]` on `AppConfig` makes the new
  `language` field safe for existing installs
- **Unknown note codes** render as-is, so a frontend/Rust version mismatch degrades
  gracefully
- **rust-analyzer false positives:** the `note()`/`note_with()` API was chosen
  (over a `&[Value]` slice param) specifically because rust-analyzer mis-resolves
  empty/typed array literals there (`{unknown}` E0308). `cargo check` (rustc)
  is authoritative and clean; the `generate_context!()` E0308 is suppressed with a
  `pi-lens-ignore` comment (documented analyzer limitation)
- **AppImage bundling** fails on `linuxdeploy` in this environment (needs
  network/FUSE); the release binary and RPM build fine

## Verification

```sh
cd app
npm run i18n:check     # catalog parity + source keys + Rust codes (exit 1 on error)
npm run build          # tsc + vite
cd src-tauri && cargo check
npm run tauri build    # release binary + RPM (+ AppImage where linuxdeploy works)
```

## Effort (actual)

| Phase | Est. | Status |
|---|---|---|
| 0 — Setup | 1–2 h | ✅ |
| 1 — Shell | 1–2 h | ✅ |
| 2 — Big views | 4–6 h | ✅ |
| 3 — Rust codes | 2–3 h | ✅ |
| 4 — Formatting | ~1 h | ✅ |
| 5 — QA/tooling | 1–2 h | ✅ |
