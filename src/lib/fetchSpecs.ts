import { invoke } from "@tauri-apps/api/core";

/**
 * Web auto-fetch (Phase 2) — result shapes as returned by the Rust
 * `fetch_specs` command (camelCase).
 */
interface SpecMatch {
 brand: string;
 model: string;
 price?: number;
 shopLink?: string;
 site: string;
}

export interface FetchedSpecs {
 match?: SpecMatch;
 /** [freq_hz, amp_db] pairs, sorted by freq. */
 frCurve?: number[][];
 frSource?: string;
 driverType?: string;
 impedanceOhms?: number;
 sensitivityDb?: number;
 imageUrl?: string;
 sources: string[];
 notes: string[];
}

/**
 * Run the best-effort spec fetch. The Rust side never errors on partial
 * failure — problems arrive in `notes`, unfetched fields stay undefined.
 */
export async function fetchSpecs(
 brand: string,
 model: string,
 deviceType: string,
): Promise<FetchedSpecs> {
 return invoke<FetchedSpecs>("fetch_specs", {
  brand,
  model,
  deviceType,
 });
}

/**
 * Download a remote product image into the media directory.
 * Returns the path relative to the media directory.
 */
export async function downloadImage(
 url: string,
 name: string,
): Promise<string> {
 return invoke<string>("media_download_image", { url, name });
}

/**
 * Save raw bytes (e.g. a rendered FR PNG) into the media directory.
 * Returns the path relative to the media directory.
 */
export async function saveMediaBytes(
 name: string,
 data: number[],
): Promise<string> {
 return invoke<string>("media_save_bytes", { name, data });
}
