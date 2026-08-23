import { invoke } from "@tauri-apps/api/core";

/**
 * Query GitHub for the latest published release tag (e.g. "v0.4.0").
 * Rejections carry short stable codes from the Rust side
 * ("no_releases", "http_403", "request_failed: …") that are safe to
 * display as-is in a muted note.
 */
export async function checkLatestVersion(): Promise<string> {
 return invoke<string>("check_latest_version");
}
