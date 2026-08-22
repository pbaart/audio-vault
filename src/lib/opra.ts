import { invoke } from "@tauri-apps/api/core";
import type { PeqBand } from "../types";
import i18n from "./i18n";

/**
 * OPRA preset lookup (primary PEQ source).
 *
 * The heavy lifting (database download/cache, matching) lives in Rust
 * (`fetch_opra.rs`); this module is the thin frontend wrapper: types, the
 * command wrapper, and the conversion from an OPRA profile to Audio Vault
 * `PeqBand`s. Attribution (author/details) travels with the data because
 * OPRA content is CC BY-SA.
 */

/** One EQ band, already mapped to the Audio Vault PEQ model by Rust. */
interface OpraBand {
 kind: "PK" | "LSC" | "HSC";
 freq: number;
 gain: number;
 q: number;
}

/** One community EQ preset for a product. */
export interface OpraProfile {
 /** Stable OPRA eq id (e.g. `sennheiser:ie800::autoeq`). */
 id: string;
 /** Preset author — must be shown with the preset (CC BY-SA). */
 author: string;
 /** Preset display name, e.g. "Harman Target", "Measured by Innerfidelity". */
 details: string;
 /** Optional source page. */
 link?: string;
 /**
  * Profile-level overall gain in dB. The band model has no global gain,
  * so it is surfaced as a note and never applied.
  */
 overallGainDb: number;
 bands: OpraBand[];
}

/** A matched product with all of its presets. */
interface OpraCandidate {
 vendor: string;
 name: string;
 /** `in_ear`, `over_the_ear`, `earbuds`, `on_ear`, … */
 subtype: string;
 profiles: OpraProfile[];
}

export interface OpraFetchResult {
 candidates: OpraCandidate[];
 /**
  * Info/warning: stale-cache notice, or an error message when no data
  * could be loaded at all. `undefined` means a clean, up-to-date lookup —
  * which makes "no candidates" a true "not found".
  */
 note?: string;
}

/**
 * Best-effort OPRA lookup by brand + model. The command itself never
 * rejects (Rust reports problems in `note`), so this only throws on
 * Tauri-layer failures.
 */
export function fetchOpraPresets(
 brand: string,
 model: string,
): Promise<OpraFetchResult> {
 return invoke<OpraFetchResult>("fetch_opra_presets", { brand, model });
}

/**
 * Convert an OPRA profile to Audio Vault bands + explanatory notes.
 * Band math is identical to what OPRA's graph uses (RBJ biquads), so the
 * stored curve and the rendered graph match OPRA's.
 */
export function toPeqBands(profile: OpraProfile): {
 bands: PeqBand[];
 notes: string[];
} {
 const bands: PeqBand[] = profile.bands.map((b) => ({
  type: b.kind,
  freq_hz: b.freq,
  gain_db: b.gain,
  q: b.q,
 }));
 const notes: string[] = [];
 if (profile.overallGainDb !== 0) {
  const g =
   profile.overallGainDb > 0
    ? `+${profile.overallGainDb}`
    : `${profile.overallGainDb}`;
  notes.push(i18n.t("opraNote.overallGainNotApplied", { p0: g }));
 }
 return { bands, notes };
}

/** Attribution string persisted as `peq_source` for an applied OPRA preset. */
export function opraSourceLabel(profile: OpraProfile): string {
 const name = profile.details || profile.id.split("::").pop() || profile.id;
 return `OPRA · ${profile.author} — ${name}`;
}
