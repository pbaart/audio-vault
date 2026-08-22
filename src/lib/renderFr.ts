/**
 * Frequency-response rendering (Phase 2).
 *
 * The fetched squig.link measurement curve is rendered to a PNG with a
 * <canvas> (active theme colors, log-frequency axis) and stored in the media
 * folder like any other image, so the data model and lightbox stay unchanged.
 */

import { chartPalette } from "./themes";

const W = 1200;
const H = 675;
const MARGIN = { top: 64, right: 34, bottom: 64, left: 78 };

const FREQ_MIN = 20;
const FREQ_MAX = 20_000;
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** Map a frequency to 0..1 across the log scale (20 Hz → 0, 20 kHz → 1). */
const xFor = (f: number): number =>
  (Math.log10(f) - Math.log10(FREQ_MIN)) / Math.log10(FREQ_MAX / FREQ_MIN);

function fmtFreq(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${f}`;
}

interface Plot {
  pts: { x: number; y: number; f: number; db: number }[];
  dbMin: number;
  dbMax: number;
}

/** Map the curve into pixel space and compute a padded dB range. */
function buildPlot(curve: number[][]): Plot {
  const xs = curve.map((p) => xFor(p[0]));
  const dbs = curve.map((p) => p[1]);
  let lo = Math.min(...dbs);
  let hi = Math.max(...dbs);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = Math.max(5, (hi - lo) * 0.12);
  lo = Math.floor((lo - pad) / 5) * 5;
  hi = Math.ceil((hi + pad) / 5) * 5;

  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = H - MARGIN.top - MARGIN.bottom;
  const pts = curve.map((p, i) => ({
    x: MARGIN.left + xs[i] * plotW,
    y: MARGIN.top + (1 - (p[1] - lo) / (hi - lo)) * plotH,
    f: p[0],
    db: p[1],
  }));
  return { pts, dbMin: lo, dbMax: hi };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  C: ReturnType<typeof chartPalette>,
): void {
  const plotH = H - MARGIN.top - MARGIN.bottom;

  // Vertical gridlines at the standard frequency ticks.
  ctx.lineWidth = 1;
  for (const f of FREQ_TICKS) {
    const x = MARGIN.left + xFor(f) * (W - MARGIN.left - MARGIN.right);
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(x, MARGIN.top);
    ctx.lineTo(x, MARGIN.top + plotH);
    ctx.stroke();
    ctx.fillStyle = C.axis;
    ctx.font = "22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fmtFreq(f), x, H - MARGIN.bottom + 32);
  }

  // Horizontal gridlines every 5 dB; 0 dB highlighted.
  for (let db = plot.dbMin; db <= plot.dbMax; db += 5) {
    const y =
      MARGIN.top + (1 - (db - plot.dbMin) / (plot.dbMax - plot.dbMin)) * plotH;
    ctx.strokeStyle = db === 0 ? C.zero : C.grid;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(W - MARGIN.right, y);
    ctx.stroke();
    ctx.fillStyle = db === 0 ? C.axis : C.label;
    ctx.font = "20px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${db}`, MARGIN.left - 12, y + 7);
  }

  // Axis titles.
  ctx.fillStyle = C.axis;
  ctx.font = "22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Frequency (Hz)", W / 2, H - 14);
  ctx.save();
  ctx.translate(24, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Amplitude (dB)", 0, 0);
  ctx.restore();
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  C: ReturnType<typeof chartPalette>,
): void {
  const plotH = H - MARGIN.top - MARGIN.bottom;
  const last = plot.pts[plot.pts.length - 1];

  // Area fill under the curve.
  const grad = ctx.createLinearGradient(0, MARGIN.top, 0, MARGIN.top + plotH);
  grad.addColorStop(0, C.fillTop);
  grad.addColorStop(1, C.fillBottom);
  ctx.beginPath();
  ctx.moveTo(plot.pts[0].x, MARGIN.top + plotH);
  for (const p of plot.pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(last.x, MARGIN.top + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Curve.
  ctx.beginPath();
  plot.pts.forEach((p, i) =>
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
  );
  ctx.strokeStyle = C.curve;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * Render a `[freq, db]` curve to a PNG. Returns the raw bytes
 * (ready for `saveMediaBytes`).
 */
export async function renderFrPng(
  curve: number[][],
  title: string,
): Promise<number[]> {
  if (!curve || curve.length < 2) {
    throw new Error("not enough curve points to render");
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas not available");

  const C = chartPalette();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const plot = buildPlot(curve);
  drawGrid(ctx, plot, C);
  drawCurve(ctx, plot, C);

  ctx.fillStyle = C.axis;
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, MARGIN.left, 38);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("could not encode PNG");
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Data model for the FR preview SVG (string builder for tests, JSX
 * component for the UI). Numeric + palette values only.
 */
export interface FrSvgModel {
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
  path: string;
  curve: string;
  label: string;
}

export function buildFrSvgModel(
  curve: number[][],
  w = 560,
  h = 220,
): FrSvgModel | null {
  if (!curve || curve.length < 2) return null;
  const C = chartPalette();
  const plot = buildPlot(curve);
  const plotH = H - MARGIN.top - MARGIN.bottom;
  const plotW = W - MARGIN.left - MARGIN.right;
  const sx = (x: number) => ((x - MARGIN.left) / plotW) * w;
  const sy = (y: number) => ((y - MARGIN.top) / plotH) * h;

  const lines: FrSvgModel["lines"] = [];
  for (const f of FREQ_TICKS) {
    const x = sx(MARGIN.left + xFor(f) * plotW);
    lines.push({ x1: x, y1: 0, x2: x, y2: h, stroke: C.grid, width: 1 });
  }
  for (let db = plot.dbMin; db <= plot.dbMax; db += 10) {
    const y = sy(
      MARGIN.top + (1 - (db - plot.dbMin) / (plot.dbMax - plot.dbMin)) * plotH,
    );
    lines.push({
      x1: 0,
      y1: y,
      x2: w,
      y2: y,
      stroke: db === 0 ? C.zero : C.grid,
      width: 1,
    });
  }
  const path = plot.pts
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`,
    )
    .join(" ");

  return {
    w,
    h,
    bg: C.bg,
    border: C.border,
    lines,
    path,
    curve: C.curve,
    label: C.label,
  };
}

/**
 * Inline preview for the fetch panel (string form — used by tests): a small
 * self-contained SVG of the curve (no canvas needed, so it can render
 * before the user applies).
 */
export function buildFrPreviewSvg(curve: number[][], w = 560, h = 220): string {
  const m = buildFrSvgModel(curve, w, h);
  if (!m) return "";
  const gridLines = m.lines.map(
    (l) =>
      `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="${l.stroke}" stroke-width="${l.width}"/>`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${m.w}" height="${m.h}" ` +
    `viewBox="0 0 ${m.w} ${m.h}" style="background:${m.bg};border:1px solid ${m.border};border-radius:6px">` +
    gridLines.join("") +
    `<path d="${m.path}" fill="none" stroke="${m.curve}" stroke-width="2" stroke-linejoin="round"/>` +
    `<text x="8" y="${m.h - 8}" fill="${m.label}" font-size="12">20 Hz</text>` +
    `<text x="${m.w - 8}" y="${m.h - 8}" fill="${m.label}" font-size="12" text-anchor="end">20 kHz</text>` +
    `</svg>`
  );
}
