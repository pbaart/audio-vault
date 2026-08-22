import type { PeqBand } from "../types";
import type { TranslateFn } from "./i18n";
import { chartPalette } from "./themes";

/**
 * PEQ curve computation + rendering.
 *
 * The stored PEQ bands (AutoEQ-compatible PK/LSC/HSC) are evaluated as RBJ
 * Audio-EQ-Cookbook biquad filters and summed into a single magnitude
 * response, which is drawn as an inline SVG (active theme colors,
 * log-frequency axis) in the device detail view instead of a band table.
 */

const FS = 48_000; // sampling rate for the filter math (shape barely changes with Fs)
const FREQ_MIN = 20;
const FREQ_MAX = 20_000;
const N_POINTS = 400;
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function peaking(f0: number, gainDb: number, q: number): Biquad {
  const w0 = (2 * Math.PI * f0) / FS;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 0.1));
  const A = 10 ** (gainDb / 40);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cosw) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

/**
 * RBJ shelf filters (verdict verified against the official WebAudio
 * Audio-EQ-Cookbook: a +6 dB LSC gives exactly +6 dB at DC and 0 dB at
 * Nyquist; the HSC is mirrored).
 */
function shelf(f0: number, gainDb: number, q: number, high: boolean): Biquad {
  const w0 = (2 * Math.PI * f0) / FS;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 1 / Math.SQRT2));
  const A = 10 ** (gainDb / 40);
  const sAa = 2 * Math.sqrt(A) * alpha;
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (high) {
    b0 = A * (A + 1 + (A - 1) * cosw + sAa);
    b1 = -2 * A * (A - 1 + (A + 1) * cosw);
    b2 = A * (A + 1 + (A - 1) * cosw - sAa);
    a0 = A + 1 - (A - 1) * cosw + sAa;
    a1 = 2 * (A - 1 - (A + 1) * cosw);
    a2 = A + 1 - (A - 1) * cosw - sAa;
  } else {
    b0 = A * (A + 1 - (A - 1) * cosw + sAa);
    b1 = 2 * A * (A - 1 - (A + 1) * cosw);
    b2 = A * (A + 1 - (A - 1) * cosw - sAa);
    a0 = A + 1 + (A - 1) * cosw + sAa;
    a1 = -2 * (A - 1 + (A + 1) * cosw);
    a2 = A + 1 + (A - 1) * cosw - sAa;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function toBiquad(band: PeqBand): Biquad | null {
  if (!Number.isFinite(band.freq_hz) || band.freq_hz <= 0) return null;
  if (!Number.isFinite(band.gain_db)) return null;
  const f0 = Math.min(Math.max(band.freq_hz, 1), FS / 2 - 1);
  const gain = Math.min(Math.max(band.gain_db, -40), 40);
  if (band.type === "LSC") return shelf(f0, gain, band.q, false);
  if (band.type === "HSC") return shelf(f0, gain, band.q, true);
  return peaking(f0, gain, band.q);
}

export interface PeqCurve {
  /** Log-spaced frequencies, Hz. */
  freqs: number[];
  /** Composite response at each frequency, dB. */
  dbs: number[];
}

/**
 * Evaluate the composite magnitude response on a log-spaced 20 Hz – 20 kHz
 * grid. EQ bands cascade, so the total gain in dB is the sum of the
 * per-band dB responses. Returns null when there are no usable bands.
 */
export function computePeqCurve(bands: PeqBand[]): PeqCurve | null {
  const filters = bands.map(toBiquad).filter((f): f is Biquad => f !== null);
  if (filters.length === 0) return null;

  const freqs: number[] = [];
  const dbs: number[] = [];
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  for (let i = 0; i < N_POINTS; i++) {
    const f = 10 ** (logMin + ((logMax - logMin) * i) / (N_POINTS - 1));
    const w = (2 * Math.PI * f) / FS;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    // z^{-1} = cw - j·sw, z^{-2} = c2 - j·s2.
    let dbTotal = 0;
    for (const fl of filters) {
      const numRe = fl.b0 + fl.b1 * cw + fl.b2 * c2;
      const numIm = -(fl.b1 * sw + fl.b2 * s2);
      const denRe = 1 + fl.a1 * cw + fl.a2 * c2;
      const denIm = -(fl.a1 * sw + fl.a2 * s2);
      dbTotal +=
        20 *
        Math.log10(
          Math.hypot(numRe, numIm) / Math.max(Math.hypot(denRe, denIm), 1e-12),
        );
    }
    freqs.push(f);
    dbs.push(dbTotal);
  }
  return { freqs, dbs };
}

const xFor = (f: number): number =>
  (Math.log10(f) - Math.log10(FREQ_MIN)) / Math.log10(FREQ_MAX / FREQ_MIN);

function fmtFreq(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${f}`;
}

interface YRange {
  lo: number;
  hi: number;
  step: number;
}

function yRange(dbs: number[]): YRange {
  // OPRA-style: a fixed ±15 dB window, expanded to clean integer bounds
  // only when the data leaves it.
  let lo = Math.min(0, -15, ...dbs);
  let hi = Math.max(0, 15, ...dbs);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    lo = -15;
    hi = 15;
  }
  lo = Math.floor(lo);
  hi = Math.ceil(hi);
  const span = hi - lo;
  const step = span > 30 ? 10 : span > 15 ? 5 : span > 6 ? 2 : 1;
  return { lo, hi, step };
}

function fmtDb(db: number): string {
  const v = Number.isInteger(db) ? String(db) : db.toFixed(1);
  return db > 0 ? `+${v}` : v;
}

/**
 * Data model for the PEQ response SVG: everything the renderers (string
 * builder for Node tests, JSX component for the UI) need. Numeric + palette
 * values only — no user-controlled text enters the SVG.
 */
export interface PeqSvgModel {
  w: number;
  h: number;
  bg: string;
  border: string;
  lines: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke: string;
    width: number;
  }[];
  labels: {
    x: number;
    y: number;
    fill: string;
    anchor: "start" | "middle" | "end";
    text: string;
  }[];
  fillPath: string;
  curvePath: string;
  /** Vertical gradient under the curve (OPRA look). */
  fillGradient: { id: string; top: string; bottom: string };
  /** Dot at each band's (frequency, gain) — OPRA's band markers. */
  markers: { x: number; y: number }[];
  markerFill: string;
  /** Top-left legend, e.g. "PEQ response · 7 bands". */
  legend: { x: number; y: number; fill: string; text: string };
  curve: string;
  axisTitle: { x: number; y: number; fill: string };
}

export function buildPeqSvgModel(bands: PeqBand[]): PeqSvgModel | null {
  const curve = computePeqCurve(bands);
  if (!curve) return null;
  const C = chartPalette();

  const w = 720;
  const h = 280;
  const margin = { top: 28, right: 16, bottom: 34, left: 48 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;
  const range = yRange(curve.dbs);
  const px = (f: number) => margin.left + xFor(f) * plotW;
  const py = (db: number) =>
    margin.top + (1 - (db - range.lo) / (range.hi - range.lo)) * plotH;
  const clampY = (y: number) =>
    Math.min(Math.max(y, margin.top + 3), margin.top + plotH - 3);

  const lines: PeqSvgModel["lines"] = [];
  const labels: PeqSvgModel["labels"] = [];
  for (const f of FREQ_TICKS) {
    const x = px(f);
    lines.push({
      x1: x,
      y1: margin.top,
      x2: x,
      y2: margin.top + plotH,
      stroke: C.grid,
      width: 1,
    });
    labels.push({
      x,
      y: h - margin.bottom + 18,
      fill: C.axis,
      anchor: "middle",
      text: fmtFreq(f),
    });
  }
  for (let db = range.lo; db <= range.hi; db += range.step) {
    const y = py(db);
    lines.push({
      x1: margin.left,
      y1: y,
      x2: w - margin.right,
      y2: y,
      stroke: db === 0 ? C.zero : C.grid,
      width: db === 0 ? 1.5 : 1,
    });
    labels.push({
      x: margin.left - 8,
      y: y + 4,
      fill: db === 0 ? C.axis : C.label,
      anchor: "end",
      text: fmtDb(db),
    });
  }

  // Band markers (dots at each band's frequency + gain, OPRA style).
  const markers: { x: number; y: number }[] = [];
  for (const b of bands) {
    if (
      !Number.isFinite(b.freq_hz) ||
      b.freq_hz < FREQ_MIN ||
      b.freq_hz > FREQ_MAX
    ) {
      continue;
    }
    if (!Number.isFinite(b.gain_db)) continue;
    markers.push({ x: px(b.freq_hz), y: clampY(py(b.gain_db)) });
  }

  const pts = curve.dbs.map((db, i) => ({
    x: px(curve.freqs[i]),
    y: py(db),
  }));
  const curvePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const fillPath =
    `M${pts[0].x.toFixed(1)},${(margin.top + plotH).toFixed(1)} ` +
    pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${pts[pts.length - 1].x.toFixed(1)},${(margin.top + plotH).toFixed(1)} Z`;

  return {
    w,
    h,
    bg: C.bg,
    border: C.border,
    lines,
    labels,
    fillPath,
    curvePath,
    fillGradient: {
      id: "peqFill",
      top: C.fillTop,
      bottom: C.fillBottom,
    },
    markers,
    markerFill: C.curve,
    legend: {
      x: margin.left + 8,
      y: margin.top - 10,
      fill: C.label,
      text: `PEQ response · ${bands.length} band${bands.length === 1 ? "" : "s"}`,
    },
    curve: C.curve,
    axisTitle: { x: margin.left + plotW / 2, y: h - 6, fill: C.label },
  };
}

/**
 * Self-contained inline SVG of the PEQ response (string form — used by
 * Node tests). Returns "" when there is nothing to draw. The SVG uses a
 * viewBox and w-full so it scales with the detail view.
 */
export function buildPeqSvg(bands: PeqBand[]): string {
  const m = buildPeqSvgModel(bands);
  if (!m) return "";

  const grid: string[] = [];
  grid.push(
    `<defs><linearGradient id="${m.fillGradient.id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="${m.fillGradient.top}"/>` +
      `<stop offset="100%" stop-color="${m.fillGradient.bottom}"/>` +
      `</linearGradient></defs>`,
  );
  for (const l of m.lines) {
    grid.push(
      `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="${l.stroke}" stroke-width="${l.width}"/>`,
    );
  }
  for (const t of m.labels) {
    grid.push(
      `<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" fill="${t.fill}" font-size="11" text-anchor="${t.anchor}">${t.text}</text>`,
    );
  }
  grid.push(
    `<text x="${m.legend.x}" y="${m.legend.y}" fill="${m.legend.fill}" font-size="11">${m.legend.text}</text>`,
  );

  const markerSvg = m.markers
    .map(
      (mk) =>
        `<circle cx="${mk.x.toFixed(1)}" cy="${mk.y.toFixed(1)}" r="3" fill="${m.markerFill}"/>`,
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" ` +
    `class="w-full" style="background:${m.bg};border:1px solid ${m.border};border-radius:6px">` +
    grid.join("") +
    `<path d="${m.fillPath}" fill="url(#${m.fillGradient.id})"/>` +
    markerSvg +
    `<path d="${m.curvePath}" fill="none" stroke="${m.curve}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<text x="${m.axisTitle.x.toFixed(1)}" y="${m.axisTitle.y.toFixed(1)}" fill="${m.axisTitle.fill}" font-size="11" text-anchor="middle">Frequency (Hz)</text>` +
    `</svg>`
  );
}

/** Compact summary line for under the graph, e.g. "7 bands: PK ×5 · LSC ×1 · HSC ×1". */
export function summarizePeq(bands: PeqBand[], t: TranslateFn): string {
  const byType: Record<string, number> = {};
  for (const b of bands) byType[b.type] = (byType[b.type] ?? 0) + 1;
  const parts = Object.entries(byType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, n]) => `${t} ×${n}`);
  return `${t("common.bands", { count: bands.length })}: ${parts.join(" · ")}`;
}
