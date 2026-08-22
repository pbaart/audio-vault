import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import de from "../locales/de.json";
import nl from "../locales/nl.json";
import fr from "../locales/fr.json";

export type LanguageId = "en" | "de" | "nl" | "fr";

/** Languages offered in the settings dropdown (native names). */
export const LANGUAGES: { id: LanguageId; nativeName: string }[] = [
 { id: "en", nativeName: "English" },
 { id: "de", nativeName: "Deutsch" },
 { id: "nl", nativeName: "Nederlands" },
 { id: "fr", nativeName: "Français" },
];

const LOCALES: Record<LanguageId, string> = {
 en: "en-GB",
 de: "de-DE",
 nl: "nl-NL",
 fr: "fr-FR",
};

export function isLanguageId(v: unknown): v is LanguageId {
 return typeof v === "string" && LANGUAGES.some((l) => l.id === v);
}

/** BCP-47 locale for Intl formatting (dates, currency) of a language. */
export function localeFor(lang: LanguageId): string {
 return LOCALES[lang] ?? "en-GB";
}

/** Detect the browser/OS language on first launch; falls back to "en". */
export function detectLanguage(): LanguageId {
 const nav = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
 const prefix = nav.slice(0, 2).toLowerCase();
 return isLanguageId(prefix) ? prefix : "en";
}

i18n.use(initReactI18next).init({
 resources: {
  en: { translation: en },
  de: { translation: de },
  nl: { translation: nl },
  fr: { translation: fr },
 },
 lng: detectLanguage(),
 fallbackLng: "en",
 interpolation: { escapeValue: false }, // React already escapes
 returnNull: false,
});

export default i18n;

/** Minimal translate signature shared by lib helpers (accepts react-i18next's `t`). */
export type TranslateFn = (
 key: string,
 opts?: Record<string, unknown>,
) => string;

/**
 * Localize a stored enum value (device type, driver, connector, …). The
 * database keeps the English values; only the display text is translated.
 * Values containing dots (e.g. "3.5mm jack") are stored with underscores
 * because i18next treats dots as key separators. Unknown values fall back
 * to the raw value.
 */
export function enumLabel(value: string, t: TranslateFn): string {
 if (i18n.exists(`values.${value}`)) return t(`values.${value}`);
 const safe = `values.${value.replace(/\./g, "_")}`;
 if (i18n.exists(safe)) return t(safe);
 return value;
}

/**
 * Localize a note/error string coming from the Rust side. Rust emits stable
 * codes like `spec.no_results`, optionally followed by `:[json array]` of
 * positional parameters (`spec.search_failed:["…"]`), mapped to the
 * `notes.<code>` key with `{{p0}}`, `{{p1}}`, … interpolation. Unknown codes
 * are returned as-is, so a frontend/Rust version mismatch degrades
 * gracefully.
 */
export function localizeNote(note: string): string {
 const idx = note.indexOf(":");
 const code = idx === -1 ? note : note.slice(0, idx);
 const key = `notes.${code}`;
 if (!i18n.exists(key)) return note;
 if (idx === -1) return i18n.t(key);
 try {
  const params = JSON.parse(note.slice(idx + 1)) as unknown;
  const opts: Record<string, unknown> = {};
  if (Array.isArray(params)) {
   params.forEach((p, i) => {
    opts[`p${i}`] = p;
   });
  }
  return i18n.t(key, opts);
 } catch {
  return note;
 }
}
