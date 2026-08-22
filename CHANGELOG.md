# Changelog

All notable changes to Audio Vault are documented in this file.

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
