import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import {
  Archive,
  Download,
  FolderOpen,
  Globe,
  HardDrive,
  Info,
  Rocket,
  RotateCw,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { siGithub } from "simple-icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getAppPaths, isTauri, type AppPaths } from "../lib/paths";
import { openMediaFolder } from "../lib/media";
import {
  createBackup,
  formatBytes,
  pickBackupArchive,
  relaunchApp,
  restoreBackup,
  type RestoreResult,
} from "../lib/backup";
import { describeTubeRule } from "../lib/tube";
import { LANGUAGES, localizeNote, type LanguageId } from "../lib/i18n";
import {
  CURRENCIES,
  DATE_FORMATS,
  type AppSettings,
  type DateFormat,
} from "../lib/settings";
import { THEMES, type ThemeId } from "../lib/themes";
import { checkLatestVersion } from "../lib/versionCheck";
import { btnPrimary, btnSecondary, btnDanger, cls, selectCls } from "../ui";
import { Modal } from "./Modal";

/** GitHub home of the project (About section links + version check). */
const GITHUB_REPO = "https://github.com/pbaart/audio-vault";

/** Link-style button used for the GitHub buttons in the About section. */
const linkBtn =
  "flex items-center gap-1.5 rounded border border-tm-dark bg-tm-darker px-2.5 py-1 text-xs text-tm-cyan transition hover:border-tm-accent hover:text-tm-fg";

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
  const [latest, setLatest] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  // Backup & restore
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [backupSize, setBackupSize] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);

  useEffect(() => {
    void getAppPaths()
      .then(setPaths)
      .catch(() => undefined);
    // App version embedded in the binary by Tauri (tauri.conf.json).
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  // Best-effort latest-release check (GitHub API) for the About section.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void checkLatestVersion()
      .then((v) => {
        if (!cancelled) setLatest(v);
      })
      .catch((e) => {
        if (!cancelled) setCheckError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOpenFolder() {
    setFolderError(null);
    try {
      await openMediaFolder();
    } catch (err) {
      setFolderError(String(err));
    }
  }

  async function handleCreateBackup() {
    setActionError(null);
    setBackupSize(null);
    setRestored(null);
    setBackupBusy(true);
    try {
      const summary = await createBackup();
      if (summary) setBackupSize(formatBytes(summary.sizeBytes));
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handlePickRestore() {
    setActionError(null);
    setBackupSize(null);
    setRestored(null);
    try {
      const path = await pickBackupArchive();
      if (path) setPendingRestore(path);
    } catch (err) {
      setActionError(String(err));
    }
  }

  async function handleConfirmRestore() {
    if (!pendingRestore) return;
    const path = pendingRestore;
    setPendingRestore(null);
    setRestoreBusy(true);
    try {
      setRestored(await restoreBackup(path));
    } catch (err) {
      setActionError(String(err));
    } finally {
      setRestoreBusy(false);
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
        <div className="grid gap-4 sm:grid-cols-2">
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
              {THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-tm-gray">{t("settings.savedNote")}</p>
      </section>

      <section className="rounded-lg border border-tm-dark bg-tm-bg p-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tm-gray">
          <Info size={14} />
          {t("settings.about")}
        </h3>
        <p className="text-sm leading-relaxed text-tm-gray">
          {t("settings.aboutNote")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-tm-gray">
          {t("settings.aboutBody", { version })}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={linkBtn}
            title={GITHUB_REPO}
            onClick={() => void openUrl(GITHUB_REPO)}
          >
            <svg
              viewBox="0 0 24 24"
              width={12}
              height={12}
              fill="currentColor"
              aria-hidden="true"
            >
              <path d={siGithub.path} />
            </svg>
            {t("settings.project")}
          </button>
          <button
            type="button"
            className={linkBtn}
            title={`${GITHUB_REPO}/releases`}
            onClick={() => void openUrl(`${GITHUB_REPO}/releases`)}
          >
            <Rocket size={12} />
            {t("settings.releases")}
          </button>
        </div>
        {isTauri() && latest === null && checkError === null && (
          <p className="mt-2 text-xs text-tm-gray">
            {t("settings.checkingVersion")}
          </p>
        )}
        {latest !== null && version !== "" && (
          <p
            className={cls(
              "mt-2 text-xs",
              latest.replace(/^v/, "") === version
                ? "text-tm-gray"
                : "text-tm-accent",
            )}
          >
            {latest.replace(/^v/, "") === version
              ? t("settings.latestCurrent", { version: latest })
              : t("settings.latestOther", { version: latest })}
          </p>
        )}
        {checkError !== null && (
          <p className="mt-2 text-xs text-tm-gray/70">
            {t("settings.checkFailed", { reason: checkError })}
          </p>
        )}
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
            type="button"
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
          <Archive size={14} />
          {t("settings.backup")}
        </h3>
        <p className="text-sm leading-relaxed text-tm-gray">
          {t("settings.backupBody")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cls(
              btnSecondary,
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
            disabled={backupBusy || restoreBusy}
            onClick={() => void handleCreateBackup()}
          >
            <Download size={14} />
            {t("settings.createBackup")}
          </button>
          <button
            type="button"
            className={cls(
              btnSecondary,
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
            disabled={backupBusy || restoreBusy}
            onClick={() => void handlePickRestore()}
          >
            <Upload size={14} />
            {t("settings.restoreBackup")}
          </button>
        </div>
        {(backupBusy || restoreBusy) && (
          <p className="mt-2 text-xs text-tm-gray">
            {backupBusy
              ? t("settings.backupWorking")
              : t("settings.restoreWorking")}
          </p>
        )}
        {backupSize !== null && (
          <p className="mt-2 text-xs text-tm-green">
            {t("settings.backupDone", { size: backupSize })}
          </p>
        )}
        {restored !== null && (
          <div className="mt-3 rounded border border-tm-green/40 bg-tm-green/10 p-3">
            <p className="text-sm leading-relaxed text-tm-fg">
              {t("settings.restoreComplete")}
            </p>
            {restored.safetyCopyPath !== "" && (
              <p className="mt-1 break-all font-mono text-xs text-tm-gray">
                {t("settings.safetyCopy")} {restored.safetyCopyPath}
              </p>
            )}
            <button
              type="button"
              className={cls(btnPrimary, "mt-3")}
              onClick={() => void relaunchApp()}
            >
              <RotateCw size={14} />
              {t("settings.restartNow")}
            </button>
          </div>
        )}
        {actionError !== null && (
          <p className="mt-2 text-xs text-tm-red">
            {localizeNote(actionError)}
          </p>
        )}
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

      {pendingRestore !== null && (
        <Modal
          title={t("settings.restoreConfirmTitle")}
          onClose={() => setPendingRestore(null)}
          maxWidthClass="max-w-lg"
          footer={
            <>
              <button
                type="button"
                className={btnSecondary}
                onClick={() => setPendingRestore(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={btnDanger}
                onClick={() => void handleConfirmRestore()}
              >
                {t("settings.restoreConfirmButton")}
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-tm-gray">
            {t("settings.restoreConfirmBody")}
          </p>
          <p className="mt-2 break-all font-mono text-xs text-tm-fg">
            {pendingRestore}
          </p>
        </Modal>
      )}
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
