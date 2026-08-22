import type { PeqBand, PeqType } from "../types";
import i18n from "./i18n";

/**
 * Parser for FiiO DSP app XML exports.
 *
 * File shape (official app, e.g. FiiO K19):
 * ```xml
 * <FiiO_DSP model="K19" version="1.0">
 *   <module name="EQ">
 *     <eqGroup>
 *       <eqList>
 *         <eq index="0">
 *           <param name="type">0</param>   <!-- 0=PK 1=LSC 2=HSC -->
 *           <param name="freq">67</param>  <!-- Hz -->
 *           <param name="gain">117</param> <!-- 0.1 dB, biased (see GAIN_OFFSET) -->
 *           <param name="q">41</param>     <!-- 0.1 Q -->
 *           <param name="s">10</param>     <!-- shelf slope — ignored -->
 *         </eq>
 *         ...
 * ```
 *
 * The official app encodes values as scaled integers. Community-generated
 * files (AutoEQ-to-FIIO, WolfEQ) write raw values into the same structure;
 * they will decode through the same math only if they are also biased —
 * imported rows always land in the editable form first, so anything that
 * decoded wrong is visible and fixable before saving.
 *
 * The `s` parameter (shelf slope) is dropped: Audio Vault's PEQ model has
 * Q for shelves, no slope.
 */

/** Official export: decoded gain (dB) = (raw - GAIN_OFFSET) / 10. */
const GAIN_OFFSET = 120;
/** Official export: decoded Q = raw / 10. */
const Q_SCALE = 10;
/** Default Q used when a band carries no usable Q value. */
const DEFAULT_Q = 0.707;
/** FiiO EQ bands only cover 20 Hz – 20 kHz; reject anything outside. */
const FREQ_MIN = 1;
const FREQ_MAX = 20_000;

const TYPE_MAP: Record<number, PeqType> = { 0: "PK", 1: "LSC", 2: "HSC" };

const EQ_BLOCK_RE = /<eq\b[^>]*>([\s\S]*?)<\/eq>/gi;
const PARAM_RE = /<param\b[^>]*\bname="(\w+)"[^>]*>([\s\S]*?)<\/param>/gi;

export interface FiioParseResult {
  bands: PeqBand[];
  /** Human-readable warnings (skipped bands, padding detection, …). */
  notes: string[];
}

/**
 * Parse a FiiO DSP XML document into PEQ bands.
 * Throws an Error with a user-readable message when the file is not a
 * FiiO DSP preset or contains no usable bands.
 */
export function parseFiioEqXml(
  xml: string,
  fileName?: string,
): FiioParseResult {
  const source = fileName ?? "the selected file";
  if (!/fiiO_DSP[\s>]|<eqList[\s>]/i.test(xml)) {
    throw new Error(
      `${source} does not look like a FiiO DSP XML preset (missing FiiO_DSP/eqList element)`,
    );
  }

  const notes: string[] = [];
  const bands: PeqBand[] = [];
  EQ_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  let index = 0;
  while ((block = EQ_BLOCK_RE.exec(xml)) !== null) {
    index += 1;
    const params: Record<string, string> = {};
    PARAM_RE.lastIndex = 0;
    let p: RegExpExecArray | null;
    while ((p = PARAM_RE.exec(block[1])) !== null) {
      // first occurrence of a param name wins
      if (!(p[1] in params)) params[p[1]] = p[2].trim();
    }

    const typeRaw = Number(params.type ?? "0");
    const type = TYPE_MAP[Number.isFinite(typeRaw) ? typeRaw : 0];
    if (params.type !== undefined && type === undefined) {
      notes.push(i18n.t("fiioeq.unknownType", { p0: index, p1: params.type }));
      continue;
    }

    const freq = Number(params.freq);
    if (!Number.isFinite(freq) || freq < FREQ_MIN || freq > FREQ_MAX) {
      notes.push(
        i18n.t("fiioeq.invalidFreq", {
          p0: index,
          p1: params.freq ?? "",
        }),
      );
      continue;
    }

    const gainRaw = Number(params.gain ?? "0");
    const gain = Number.isFinite(gainRaw)
      ? round2((gainRaw - GAIN_OFFSET) / 10)
      : 0;

    let q = Number(params.q) / Q_SCALE;
    if (!Number.isFinite(q) || q <= 0) {
      q = DEFAULT_Q;
      notes.push(
        i18n.t("fiioeq.invalidQ", {
          p0: index,
          p1: params.q ?? "",
          p2: DEFAULT_Q,
        }),
      );
    } else {
      q = round2(q);
    }

    bands.push({
      type,
      freq_hz: round1(freq),
      gain_db: gain,
      q,
    });
  }

  if (bands.length === 0) {
    throw new Error(i18n.t("fiioeq.noBands", { p0: source }));
  }

  // FiiO pads unused slots with identical copies of a default band
  // (e.g. 21 × the same PK band at the end of a 31-band export). Flag
  // long identical tail runs so the user can drop them deliberately.
  const trailing = trailingIdenticalRun(bands);
  if (trailing >= 10) {
    const last = bands.at(-1)!;
    notes.push(
      i18n.t("fiioeq.trailingPadding", {
        p0: trailing,
        p1: last.type,
        p2: last.freq_hz,
      }),
    );
  }

  return { bands, notes };
}

/** Draft values for the form (the form stores numbers as strings). */
export function toPeqDraft(bands: PeqBand[]): {
  type: PeqType;
  freq: string;
  gain: string;
  q: string;
}[] {
  return bands.map((b) => ({
    type: b.type,
    freq: String(b.freq_hz),
    gain: String(b.gain_db),
    q: b.type === "HSC" ? "" : String(b.q),
  }));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Count how many trailing bands are identical to the very last band. */
function trailingIdenticalRun(bands: PeqBand[]): number {
  const last = bands.at(-1)!;
  let n = 0;
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    if (
      b.type === last.type &&
      b.freq_hz === last.freq_hz &&
      b.gain_db === last.gain_db &&
      b.q === last.q
    ) {
      n += 1;
    } else {
      break;
    }
  }
  return n;
}
