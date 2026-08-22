/**
 * UI themes.
 *
 * Tailwind v4 utilities compile to `var(--color-tm-*)`, so switching themes
 * means redefining those CSS variables on `<html>` (see index.css, which
 * carries the same token values per `[data-theme]`). This module owns:
 *
 *  - the theme ids/labels used by the Settings screen,
 *  - normalization of legacy/unknown stored values (old configs say "dark"),
 *  - the chart palettes used by the canvas/SVG renderers (renderFr.ts,
 *    peqCurve.ts), which cannot read CSS variables in Node tests,
 *  - the `data-theme` attribute + localStorage mirror (index.html reads the
 *    mirror before first paint to avoid a theme flash).
 *
 * Keep the token values in sync with the `@theme`/`[data-theme]` blocks in
 * src/index.css.
 */

export type ThemeId =
  | "tokyonight"
  | "gruvbox"
  | "dracula"
  | "catppuccin"
  | "monokai"
  | "catppuccin-latte"
  | "gruvbox-light"
  | "tokyo-day";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "tokyonight", label: "Tokyo Night" },
  { id: "gruvbox", label: "Gruvbox Dark" },
  { id: "dracula", label: "Dracula" },
  { id: "catppuccin", label: "Catppuccin Mocha" },
  { id: "monokai", label: "Monokai" },
  { id: "catppuccin-latte", label: "Catppuccin Latte" },
  { id: "gruvbox-light", label: "Gruvbox Light" },
  { id: "tokyo-day", label: "Tokyo Day" },
];

const THEME_IDS: ThemeId[] = THEMES.map((t) => t.id);

/**
 * Map any stored value to a known theme. Legacy configs (and the Rust
 * default) store `"dark"`, which was always Tokyo Night.
 */
export function normalizeTheme(value: string | undefined | null): ThemeId {
  if (!value) return "tokyonight";
  const v = value.toLowerCase();
  if ((THEME_IDS as string[]).includes(v)) return v as ThemeId;
  if (v === "dark" || v === "tokyo" || v === "tokyo-night") return "tokyonight";
  return "tokyonight";
}

/** Colors the canvas/SVG chart renderers need (see withAlpha below). */
interface Tokens {
  darker: string;
  dark: string;
  fg: string;
  gray: string;
  accent: string;
}

const TOKENS = {
  tokyonight: {
    darker: "#1a1b26",
    dark: "#24283b",
    fg: "#c0caf5",
    gray: "#565f89",
    accent: "#7aa2f7",
  },
  gruvbox: {
    darker: "#1d2021",
    dark: "#3c3836",
    fg: "#ebdbb2",
    gray: "#928374",
    accent: "#fabd2f",
  },
  dracula: {
    darker: "#1e1f29",
    dark: "#282a36",
    fg: "#f8f8f2",
    gray: "#6272a4",
    accent: "#bd93f9",
  },
  catppuccin: {
    darker: "#11111b",
    dark: "#313244",
    fg: "#cdd6f4",
    gray: "#6c7086",
    accent: "#89b4fa",
  },
  monokai: {
    darker: "#1e1f1c",
    dark: "#3e3d32",
    fg: "#f8f8f2",
    gray: "#75715e",
    accent: "#66d9ef",
  },
  "catppuccin-latte": {
    darker: "#dce0e8",
    dark: "#ccd0da",
    fg: "#4c4f69",
    gray: "#6c6f85",
    accent: "#1e66f5",
  },
  "gruvbox-light": {
    darker: "#f9f5d7",
    dark: "#ebdbb2",
    fg: "#282828",
    gray: "#928374",
    accent: "#b57614",
  },
  "tokyo-day": {
    darker: "#f6f7fb",
    dark: "#c9cbdd",
    fg: "#545c7e",
    gray: "#545c7e",
    accent: "#3454d1",
  },
};

/** `#rrggbb` + alpha (0..1) → `rgba(r, g, b, a)` string. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface ChartPalette {
  /** Plot background (theme's darkest surface). */
  bg: string;
  grid: string;
  /** Emphasized 0 dB line. */
  zero: string;
  axis: string;
  label: string;
  curve: string;
  /** Area fill under the curve (solid, PEQ SVG). */
  fill: string;
  /** Gradient stops for the FR PNG fill. */
  fillTop: string;
  fillBottom: string;
  border: string;
}

const chartFrom = (t: Tokens): ChartPalette => ({
  bg: t.darker,
  grid: withAlpha(t.accent, 0.14),
  zero: withAlpha(t.fg, 0.45),
  axis: t.fg,
  label: t.gray,
  curve: t.accent,
  fill: withAlpha(t.accent, 0.18),
  fillTop: withAlpha(t.accent, 0.28),
  fillBottom: withAlpha(t.accent, 0.02),
  border: t.dark,
});

const CHART_PALETTES = {
  tokyonight: chartFrom(TOKENS.tokyonight),
  gruvbox: chartFrom(TOKENS.gruvbox),
  dracula: chartFrom(TOKENS.dracula),
  catppuccin: chartFrom(TOKENS.catppuccin),
  monokai: chartFrom(TOKENS.monokai),
  "catppuccin-latte": chartFrom(TOKENS["catppuccin-latte"]),
  "gruvbox-light": chartFrom(TOKENS["gruvbox-light"]),
  "tokyo-day": chartFrom(TOKENS["tokyo-day"]),
} satisfies Record<ThemeId, ChartPalette>;

const LS_KEY = "audio-vault.theme";

let current: ThemeId = "tokyonight";

/** Palette for the active theme (defaults to Tokyo Night until set). */
export function chartPalette(): ChartPalette {
  return CHART_PALETTES[current];
}

/**
 * Activate a theme: CSS variables via `data-theme`, plus the localStorage
 * mirror index.html reads before first paint. DOM access is guarded so the
 * module stays importable in Node (tests).
 */
export function setTheme(value: string): void {
  current = normalizeTheme(value);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", current);
  }
  try {
    localStorage.setItem(LS_KEY, current);
  } catch {
    // storage unavailable (private mode / tests) — attribute is enough
  }
}
