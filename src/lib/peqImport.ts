import type { PeqBand, PeqType } from "../types";
import i18n from "./i18n";
import { parseFiioEqXml } from "./parseFiioEq";

/**
 * PEQ file import (fallback when a device is not found in OPRA).
 *
 * Dispatches on file extension:
 *  - `.xml` / `.txt` → the FiiO DSP XML codec (parseFiioEq.ts),
 *  - `.json`         → the generic parser below, which accepts a bare band
 *                      array, `{ bands: [...] }` (Audio Vault's stored
 *                      format), and OPRA-style entries (single eq entry or
 *                      product entry with profiles).
 *
 * The generic parser is deliberately permissive about key names so exports
 * from other tools (REW, AutoEQ, OPRA site export) import without editing.
 */

export interface PeqImportResult {
  bands: PeqBand[];
  /** Non-fatal observations (skipped bands, assumptions made). */
  notes: string[];
  /**
   * Attribution when the file carries one (OPRA-style entries have an
   * author) — CC BY-SA content must keep its source.
   */
  attribution: string | null;
}

const FREQ_KEYS = ["freq", "frequency", "freq_hz", "f_hz", "f"];
const GAIN_KEYS = ["gain", "gain_db", "gaindb", "db"];
const Q_KEYS = ["q", "Q", "bandwidth_q"];
const TYPE_MAP: Record<string, PeqType> = {
  pk: "PK",
  peak: "PK",
  peaking: "PK",
  peak_dip: "PK",
  peaking_filter: "PK",
  lsc: "LSC",
  ls: "LSC",
  lowshelf: "LSC",
  low_shelf: "LSC",
  low_shelf_filter: "LSC",
  hsc: "HSC",
  hs: "HSC",
  highshelf: "HSC",
  high_shelf: "HSC",
  high_shelf_filter: "HSC",
};
const DEFAULT_Q = 0.707;

function firstNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.trim());
      if (v.trim() !== "" && Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Parse one raw band object; null when unusable (a note is appended). */
function parseBand(
  raw: unknown,
  index: number,
  notes: string[],
): PeqBand | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    notes.push(i18n.t("peqImport.bandSkippedNotObject", { p0: index + 1 }));
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const freq = firstNum(obj, FREQ_KEYS);
  const gain = firstNum(obj, GAIN_KEYS);
  if (freq === null || gain === null) {
    notes.push(i18n.t("peqImport.bandSkippedNoFreqGain", { p0: index + 1 }));
    return null;
  }
  if (freq < 1 || freq > 20_000) {
    notes.push(
      i18n.t("peqImport.bandSkippedFreqRange", { p0: index + 1, p1: freq }),
    );
    return null;
  }

  let type: PeqType = "PK";
  const typeRaw = obj.type ?? obj.filter_type ?? obj.kind;
  if (typeof typeRaw === "string") {
    const key = typeRaw
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const mapped = TYPE_MAP[key];
    if (mapped) {
      type = mapped;
    } else {
      notes.push(
        i18n.t("peqImport.bandUnknownType", { p0: index + 1, p1: typeRaw }),
      );
    }
  } else {
    notes.push(i18n.t("peqImport.bandMissingType", { p0: index + 1 }));
  }

  const q = firstNum(obj, Q_KEYS);
  if (q === null || q <= 0) {
    if (q !== null)
      notes.push(i18n.t("peqImport.bandInvalidQ", { p0: index + 1 }));
    return { type, freq_hz: freq, gain_db: gain, q: DEFAULT_Q };
  }
  return { type, freq_hz: freq, gain_db: gain, q };
}

/**
 * Parse a generic JSON PEQ file. Accepted roots:
 *  - an array of bands,
 *  - `{ bands: [...] }` / `{ peq: [...] }` / `{ eq: [...] }`,
 *  - an OPRA eq entry: `{ type: "eq", data: { parameters: { bands } } }`,
 *  - an OPRA product entry: `{ type: "product", data: { profiles: [...] } }`
 *    (first profile is used).
 */
export function parseGenericPeqJson(json: string): PeqImportResult {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON — the file could not be parsed");
  }

  const notes: string[] = [];
  let rawBands: unknown[] | null = null;
  let attribution: string | null = null;

  if (Array.isArray(root)) {
    rawBands = root;
  } else if (typeof root === "object" && root !== null) {
    const obj = root as Record<string, unknown>;
    const data =
      typeof obj.data === "object" && obj.data !== null
        ? (obj.data as Record<string, unknown>)
        : null;

    if (obj.type === "eq" && data) {
      const params =
        typeof data.parameters === "object" && data.parameters !== null
          ? (data.parameters as Record<string, unknown>)
          : null;
      if (params && Array.isArray(params.bands)) {
        rawBands = params.bands as unknown[];
        if (typeof data.author === "string") {
          const details =
            typeof data.details === "string" ? ` — ${data.details}` : "";
          attribution = `OPRA · ${data.author}${details}`;
        }
      }
    } else if (obj.type === "product" && data && Array.isArray(data.profiles)) {
      const profiles = data.profiles as Record<string, unknown>[];
      if (profiles.length > 1) {
        notes.push(
          i18n.t("peqImport.multipleProfiles", { p0: profiles.length }),
        );
      }
      const first = profiles[0] ?? {};
      const params =
        typeof first.parameters === "object" && first.parameters !== null
          ? (first.parameters as Record<string, unknown>)
          : null;
      if (params && Array.isArray(params.bands)) {
        rawBands = params.bands as unknown[];
        if (typeof first.author === "string") {
          const details =
            typeof first.details === "string" ? ` — ${first.details}` : "";
          attribution = `OPRA · ${first.author}${details}`;
        }
      }
    }

    if (!rawBands) {
      for (const key of ["bands", "peq", "eq"]) {
        if (Array.isArray(obj[key])) {
          rawBands = obj[key] as unknown[];
          break;
        }
      }
    }
  }

  if (!rawBands) {
    throw new Error(
      "No PEQ bands found — expected an array of bands, { bands: [...] }, or an OPRA entry",
    );
  }
  if (rawBands.length === 0) {
    throw new Error("The file contains no bands");
  }

  const bands: PeqBand[] = [];
  for (let i = 0; i < rawBands.length; i++) {
    const b = parseBand(rawBands[i], i, notes);
    if (b) bands.push(b);
  }
  if (bands.length === 0) {
    throw new Error("No valid bands found in the file");
  }
  return { bands, notes, attribution };
}

/**
 * Parse a PEQ file for import, dispatching on its extension.
 * Throws with a user-readable message on any failure.
 */
export function parsePeqFile(
  fileName: string,
  content: string,
): PeqImportResult {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xml" || ext === "txt") {
    const r = parseFiioEqXml(content, fileName);
    return { bands: r.bands, notes: r.notes, attribution: null };
  }
  if (ext === "json") {
    return parseGenericPeqJson(content);
  }
  throw new Error(
    `Unsupported file type “.${ext}” — expected .xml (FiiO DSP) or .json`,
  );
}
