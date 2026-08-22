import { invoke } from "@tauri-apps/api/core";

/** XDG paths resolved on the Rust side (`init_app_data` command). */
export interface AppPaths {
 /** `~/.local/share/audio-vault/collection.db` */
 db: string;
 /** `~/.local/share/audio-vault/media/` */
 media: string;
 /** `~/.config/audio-vault/config.json` */
 config: string;
}

let cached: AppPaths | null = null;

/**
 * Resolve the application paths. Idempotent on the Rust side (creates the
 * XDG layout on first run) and cached afterwards.
 */
export async function getAppPaths(): Promise<AppPaths> {
 if (!cached) {
  cached = await invoke<AppPaths>("init_app_data");
 }
 return cached;
}

/** True when running inside a Tauri webview (vs. plain `vite` in a browser). */
export function isTauri(): boolean {
 return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
