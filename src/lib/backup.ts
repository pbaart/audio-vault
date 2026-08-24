import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";

/** Result of a successful backup (Rust side). */
export interface BackupSummary {
 sizeBytes: number;
 mediaFiles: number;
}

/** Result of a successful restore (Rust side). */
export interface RestoreResult {
 /** Where the pre-restore state was archived ("" = nothing to protect). */
 safetyCopyPath: string;
 mediaFiles: number;
}

/** Human-readable file size (e.g. "23.4 MB"). */
export function formatBytes(bytes: number): string {
 if (bytes < 1024) return `${bytes} B`;
 const units = ["KB", "MB", "GB"];
 let value = bytes;
 let unit = "B";
 for (const u of units) {
  if (value < 1024) break;
  value /= 1024;
  unit = u;
 }
 return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

function stamp(): string {
 const d = new Date();
 const p = (n: number) => String(n).padStart(2, "0");
 return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(
  d.getDate(),
 )}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

/**
 * Open the native save dialog and create the backup archive (database +
 * media) at the chosen location. Returns null when the user cancels the
 * dialog. Rejections carry Rust error strings, possibly as stable note
 * codes for localization.
 */
export async function createBackup(): Promise<BackupSummary | null> {
 const dest = await save({
  defaultPath: `audio-vault-backup-${stamp()}.zip`,
  filters: [{ name: "Audio Vault backup", extensions: ["zip"] }],
 });
 if (!dest) return null;
 return invoke<BackupSummary>("create_backup", { destPath: dest as string });
}

/** Open the native file picker for backup archives. Null on cancel. */
export async function pickBackupArchive(): Promise<string | null> {
 const selected = await open({
  multiple: false,
  filters: [{ name: "Audio Vault backup", extensions: ["zip"] }],
 });
 return typeof selected === "string" ? selected : null;
}

/**
 * Restore the collection from a backup archive. Validates everything first
 * and keeps an automatic pre-restore safety copy. The app must be
 * restarted afterwards for the restored database/media to take effect.
 */
export async function restoreBackup(srcPath: string): Promise<RestoreResult> {
 return invoke<RestoreResult>("restore_backup", { srcPath });
}

/** Relaunch the app (used after a restore). */
export async function relaunchApp(): Promise<void> {
 await relaunch();
}
