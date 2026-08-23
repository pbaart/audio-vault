# Changelog

All notable changes to Audio Vault are documented in this file.

## [Unreleased]

### Added

- **Ownership status** for both headphones and devices (migration v21):
  mark an item as *Owned*, *Sold*, *Not in use* or *Loaned out* in the
  form's Basic section (empty = not marked). The status shows as a chip
  on collection cards (non-owned statuses only — owned is the default),
  a column in the table view, and in the detail view's identity chips.
- **GitHub info on the settings page:** the About section now links to
  the project and its releases, shows the latest release tag via a
  best-effort GitHub API check (`check_latest_version` command) —
  "up to date" or "latest release: vX.Y.Z", with a muted note on failure —
  and carries a short vibe-coded / use-at-your-own-risk note; the Project
  button shows the GitHub mark from the `simple-icons` package.
- **Window resize handles (Linux):** the undecorated window can now be
  resized from any edge or corner via edge strips calling Tauri's
  `start_resize_dragging`; scrollbars are themed to match the active
  color scheme.
- **View/edit mode toggle** in the title bar: switch the app to a
  read-only view mode that hides every add, edit and delete button in
  the collection views (toolbar, cards, table) and the detail view;
  the choice persists across restarts.
- **New enum values:** *Bone Conduction* headphone type and *Wireless*
  connector type (form selects, filters and labels in all four
  languages).
- **Sort by rating** in the collection views (unrated items sort last,
  like the other numeric sorts).

### Fixed

- Saving a headphone wiped its product-image gallery: the form's submit
  handler only persisted the gallery for the devices category, so every
  save of a headphone reset `images` to an empty array (the mood image
  was unaffected). The gallery now saves for both categories. Media
  files of previously wiped entries were never deleted and remain in
  the media folder — re-add them via the gallery picker if needed.

## [0.4.0] - 2026-08-23

### Added

- **Devices category** alongside headphones: 12 device types (DAC,
  Dongle DAC, DAC+AMP, AMP, BT Amp, Tube Amp, Power Amp, Preamp,
  Streamer, Phono Stage, Turntable, AVR), each with its own collection
  page, filters and spec fields (DAC chip, supported formats, Bluetooth
  codecs, inputs/outputs via a chip input, amplifier specs, AVR extras).
  Web fetch, The Sound, FR and PEQ stay headphones-only.
- **Multi-image product gallery** for both categories: add images via
  file picker or URL download, remove, and reorder; the mood image is
  the cover shown in cards and the detail hero. Legacy single product
  images were moved into the gallery automatically (migrations v19/v20).
- **Image scaler:** multi-MB originals are downscaled on first use and
  cached on disk (`media/.cache/`, Lanczos3, JPEG q82/PNG), so grids and
  cards load ~100 KB copies while the lightbox keeps full resolution.
- **Themed window chrome on Linux:** the native title bar is replaced by
  an in-app bar matching the active color scheme — app identity + nav,
  minimize/maximize/close, drag to move, double-click to maximize,
  icon-color hover states and the app's standard tooltips.
- **"Recently modified" sort** backed by a new `updated_at` column
  (migration v15).
- **Calendar popup** for the purchase date: themed month-grid popover
  instead of the unreliable WebKitGTK native date input.

### Changed

- Filter option labels now show plain values with an "All {field}"
  default per category.
- Color scheme moved from a standalone section into Settings
  → Preferences.
- Mouse back/forward buttons (and Alt+Left/Right) navigate between
  views; history entries carry their category so back lands on the page
  a device was opened from.
- The "Collection" nav button is now "Headphones".
- The edit dialog's Images section is identical for both categories
  (mood image + product-image gallery); web-fetched product images are
  added to the gallery.
- Window control buttons: hover changes the icon color (no background),
  tooltips use the app's styled Tip component.

### Fixed

- A save-path bug bound every value from `price` onward to the wrong
  database column whenever the new `images` field was present; the
  affected rows were repaired and the statement order is now verified
  by a scripted cross-check of columns vs. placeholders vs. values.
- Migration v19 originally shipped with double-escaped line
  continuations that put literal backslashes into the SQL; rewritten as
  a single-line statement.
- Sound-rating clamping rounded 0.5 up to 1 in five places of the save
  path.
- The devices-category INSERT statement had 45 columns but 38
  placeholders; rebuilt and cross-checked.

## [0.3.0] - 2026-08-22

### Added

- Overall star rating with half-star support (0.5–5) on the edit form,
  the device detail view, and the collection table/grid views.
- "The Sound" section in the detail view with five rated attributes —
  soundstage, imaging, detail retrieval, timbre, tonal balance — each
  with an info popover explaining what it is and how it sounds.
- Interactive dot rating input for the sound attributes with half-dot
  support: hover to preview, click to set, click the active half again
  to clear (mirrors the star rating).
- Custom field ("Extra") key autocomplete in the edit dialog, suggesting
  keys already used elsewhere in the collection.
- Settings → About now shows the real application version, read from the
  binary at runtime instead of a hardcoded string.

### Changed

- Edit dialog reorganized into titled sections matching the detail view:
  Basic, Web fetch, Technical Specs, Extra, The Sound, Listening Notes,
  Images, Links, Frequency Response, PEQ Settings. Tube amp
  compatibility was merged into Technical Specs and the overall rating
  moved to Basic.
- Detail view device card reworked: rating under the name, icon chips
  for type / driver / color / connector / tube amp, and the product
  image shown below the card when a mood image is the hero.
- Styled hover tooltips showing the field name on every badge/pill in
  the app (detail card, collection table, grid cards, form preview).
- Sound ratings now support half steps (0.5–5); existing whole-number
  ratings are preserved.
- Tube amp badge uses a siren icon instead of a flame.
- Technical Specs order adjusted (Price ↔ Drive difficulty), and empty
  sections (Extra, Frequency Response, PEQ Settings) are hidden in the
  detail view when they have no data.

### Fixed

- The app no longer closes instantly after launch on KWin/Wayland: the
  WebKitGTK dmabuf renderer is disabled by default (override with
  `WEBKIT_DISABLE_DMABUF_RENDERER`).

## [0.2.0] - 2026-08-22

### Added

- **Mood image** alongside the product image: a second image slot for a
  lifestyle shot of the gear, later used as the card/hero cover.
- **Download image from URL** option in the device form.
- Three light color schemes: Catppuccin Latte, Gruvbox Light and
  Tokyo Day (the five dark schemes remain available).

### Changed

- Grid view tube badge redesigned: a solid colored dot
  (green/orange/blue/grey) on the mood image, with a tooltip naming the
  tube-amp compatibility result.
- Driver type "BA" renamed to "Balanced Armature".
- Detail view: the Measurements (frequency response) section now comes
  before PEQ Settings.
- Internal: Rust edition 2024 and let-chains, dead code removed, CI on
  Node 24 LTS and hardened against zizmor security findings.

## [0.1.0] - 2026-08-22

First release — the headphones MVP:

- Collection manager for headphones and IEMs: grid and table views with
  search, filters (type / driver / tube-amp compatibility) and sorting,
  plus an add/edit dialog with validation and brand/color autocomplete
- Web auto-fetch: frequency-response graphs and prices from squig.link
  (raw REW data rendered to PNG in-app), driver type / impedance /
  sensitivity via keyless web search, product image download — only
  empty fields are ever filled, nothing saved without review
- PEQ settings: OPRA community-preset lookup (database downloaded and
  cached locally), FiiO DSP XML / JSON import, OPRA-styled response
  graph with per-device attribution
- Tube-amp compatibility badge computed from impedance + driver type
  (override-able per device)
- Lightbox image viewer at full resolution
- Five dark color schemes (Tokyo Night default, Gruvbox Dark, Dracula,
  Catppuccin Mocha, Monokai); interface in English, German, Dutch and
  French
- Local-first storage: SQLite database and media in XDG directories —
  nothing leaves the machine
- GitHub Actions CI building Linux (.deb, .rpm, .AppImage) and macOS
  (.app, .dmg) bundles plus a source tarball on tag push; MIT licensed
