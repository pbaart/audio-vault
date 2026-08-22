import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import {
  FolderOpen,
  Globe,
  HardDrive,
  Info,
  Palette,
  SlidersHorizontal,
} from "lucide-react";
import { getAppPaths, type AppPaths } from "../lib/paths";
import { openMediaFolder } from "../lib/media";
import { describeTubeRule } from "../lib/tube";
import { LANGUAGES, localizeNote, type LanguageId } from "../lib/i18n";
import {
  CURRENCIES,
  DATE_FORMATS,
  type AppSettings,
  type DateFormat,
} from "../lib/settings";
import { THEMES, type ThemeId } from "../lib/themes";
import { btnSecondary, cls, selectCls } from "../ui";

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * Settings screen: display preferences (currency, date format), XDG paths,
 * media folder access, rules reference, about.
 */
export function SettingsView({
  settings,
  onSettingsChange,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getAppPaths()
      .then(setPaths)
      .catch(() => undefined);
    // App version embedded in the binary by Tauri (tauri.conf.json).
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  async function handleOpenFolder() {
    setFolderError(null);
    try {
      await openMediaFolder();
    } catch (err) {
      setFolderError(String(err));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold text-tm-fg">
        {t("settings.title")}
      </h2>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <SlidersHorizontal size={14} />
          {t("settings.preferences")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs text-tm-gray">
              {t("settings.language")}
            </span>
            <select
              className={cls(selectCls, "mt-1 w-full")}
              value={settings.language}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  language: e.target.value as LanguageId,
                })
              }
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nativeName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-tm-gray">
              {t("settings.currency")}
            </span>
            <select
              className={cls(selectCls, "mt-1 w-full")}
              value={settings.currency}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  currency: e.target.value,
                })
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-tm-gray">
              {t("settings.dateFormat")}
            </span>
            <select
              className={cls(selectCls, "mt-1 w-full")}
              value={settings.dateFormat}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  dateFormat: e.target.value as DateFormat,
                })
              }
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-tm-gray">{t("settings.savedNote")}</p>
      </section>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <Globe size={14} />
          {t("settings.webFetch")}
        </h3>
        <p className="text-sm leading-relaxed text-tm-gray">
          {t("settings.webFetchBody")}
        </p>
      </section>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <Palette size={14} />
          {t("settings.theme")}
        </h3>
        <label className="block">
          <span className="text-xs text-tm-gray">
            {t("settings.colorScheme")}
          </span>
          <select
            className={cls(selectCls, "mt-1 w-full")}
            value={settings.theme}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                theme: e.target.value as ThemeId,
              })
            }
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <HardDrive size={14} />
          {t("settings.storage")}
        </h3>
        <dl className="space-y-3">
          <PathRow label={t("settings.database")} value={paths?.db} />
          <PathRow label={t("settings.media")} value={paths?.media} />
          <PathRow label={t("settings.config")} value={paths?.config} />
        </dl>
        <div className="mt-4">
          <button
            className={btnSecondary}
            onClick={() => void handleOpenFolder()}
          >
            <FolderOpen size={14} />
            {t("settings.openMediaFolder")}
          </button>
          {folderError && (
            <p className="mt-2 text-xs text-tm-red">
              {localizeNote(folderError)}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <Info size={14} />
          {t("settings.tubeRule")}
        </h3>
        <p className="text-sm leading-relaxed text-tm-gray">
          {describeTubeRule((k) => t(k))}
        </p>
      </section>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <Info size={14} />
          {t("settings.about")}
        </h3>
        <p className="text-sm leading-relaxed text-tm-gray">
          {t("settings.aboutBody", { version })}
        </p>
      </section>
    </div>
  );
}

function PathRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <div>
      <dt className="text-xs text-tm-gray">{label}</dt>
      <dd className="break-all font-mono text-xs text-tm-fg">{value ?? "…"}</dd>
    </div>
  );
}
