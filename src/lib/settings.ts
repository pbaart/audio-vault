import { invoke } from "@tauri-apps/api/core";
import { isLanguageId, type LanguageId } from "./i18n";
import { isTauri } from "./paths";
import { normalizeTheme, type ThemeId } from "./themes";

export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";

export interface AppSettings {
  theme: ThemeId;
  /** ISO 4217 currency code, e.g. `EUR`. */
  currency: string;
  dateFormat: DateFormat;
  /** UI language; "en" is the source language and fallback. */
  language: LanguageId;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "tokyonight",
  currency: "EUR",
  dateFormat: "DD/MM/YYYY",
  language: "en",
};

export const CURRENCIES: { code: string; label: string }[] = [
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "DKK", label: "DKK — Danish Krone" },
  { code: "NOK", label: "NOK — Norwegian Krone" },
  { code: "SEK", label: "SEK — Swedish Krona" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
];

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (21/08/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-08-21)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (08/21/2026)" },
];

let cached: AppSettings | null = null;

/** Load settings (Rust side, persisted in config.json; falls back to defaults). */
export async function getSettings(): Promise<AppSettings> {
  if (cached) return cached;
  if (!isTauri()) {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  try {
    const fromRust = await invoke<Partial<AppSettings>>("read_config");
    cached = {
      ...DEFAULT_SETTINGS,
      ...fromRust,
      theme: normalizeTheme(
        (fromRust as Record<string, unknown>).theme as string | undefined,
      ),
      language: isLanguageId(fromRust.language)
        ? fromRust.language
        : DEFAULT_SETTINGS.language,
    };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

/**
 * Persist a patch over the current settings and return the merged result.
 * The cache is only updated after a successful write, so a failure keeps
 * the previous values.
 */
export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    theme:
      patch.theme === undefined ? current.theme : normalizeTheme(patch.theme),
  };
  if (isTauri()) {
    await invoke("save_config", { config: next });
  }
  cached = next;
  return next;
}
