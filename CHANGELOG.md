# Changelog

All notable changes to Audio Vault are documented in this file.

## [Unreleased]

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
  an in-app bar matching the active color scheme — app identity + nav
  + minimize/maximize/close, drag to move, double-click to maximize,
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
