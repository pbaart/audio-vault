import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Headphones, Plus, Settings } from "lucide-react";
import type { Device } from "./types";
import { deleteDevice, getDevice, listDevices } from "./lib/db";
import { getAppPaths } from "./lib/paths";
import i18n, { localizeNote } from "./lib/i18n";
import { getSettings, updateSettings, type AppSettings } from "./lib/settings";
import { setTheme } from "./lib/themes";
import { removeMediaFile, setMediaDir } from "./lib/media";
import { CollectionView } from "./components/CollectionView";
import { DeviceDetailView } from "./components/DeviceDetailView";
import { DeviceFormDialog } from "./components/DeviceFormDialog";
import { SettingsView } from "./components/SettingsView";
import { Modal } from "./components/Modal";
import { btnDanger, btnSecondary, cls } from "./ui";

type View =
  | { name: "collection" }
  | { name: "device"; id: string }
  | { name: "settings" };

export default function App() {
  const { t } = useTranslation();
  const [booted, setBooted] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device | null>(null);
  const [view, setView] = useState<View>({ name: "collection" });
  const [formState, setFormState] = useState<{
    open: boolean;
    device: Device | null;
  }>({ open: false, device: null });
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDevices(await listDevices());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [paths, appSettings] = await Promise.all([
          getAppPaths(),
          getSettings(),
        ]);
        if (cancelled) return;
        setMediaDir(paths.media);
        setSettings(appSettings);
        i18n.changeLanguage(appSettings.language);
        await refresh();
        if (!cancelled) setBooted(true);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  function openDevice(id: string) {
    void getDevice(id).then((d) => {
      if (d) {
        setSelected(d);
        setView({ name: "device", id });
      }
    });
  }

  function handleSaved(device: Device) {
    setFormState({ open: false, device: null });
    void refresh();
    if (view.name === "device" && view.id === device.id) {
      setSelected(device);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const d = deleteTarget;
    try {
      await deleteDevice(d.id);
      // Clean up media files owned by this device (best effort).
      void removeMediaFile(d.image_path);
      void removeMediaFile(d.mood_image_path);
      void removeMediaFile(d.fr_graph_path);
      setDeleteTarget(null);
      if (view.name === "device" && view.id === d.id) {
        setView({ name: "collection" });
        setSelected(null);
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  function handleSettingsChange(next: AppSettings) {
    if (settings && next.theme !== settings.theme) setTheme(next.theme);
    if (settings && next.language !== settings.language) {
      i18n.changeLanguage(next.language);
    }
    setSettings(next); // optimistic
    updateSettings(next).catch((err) => {
      setError(String(err));
      void getSettings().then((s) => {
        setTheme(s.theme);
        setSettings(s);
      }); // revert to persisted values
    });
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-tm-bg p-8 text-center">
        <h1 className="text-lg font-semibold text-tm-red">{t("app.error")}</h1>
        <p className="max-w-md break-all text-sm text-tm-gray">
          {localizeNote(error)}
        </p>
      </div>
    );
  }

  if (!booted || !settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-tm-bg">
        <p className="text-sm text-tm-gray">{t("app.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-tm-bg text-tm-fg">
      <header className="flex items-center gap-4 border-b border-tm-dark bg-tm-darker px-4 py-2">
        <div className="flex items-center gap-2">
          <AudioLines size={20} className="text-tm-accent" />
          <span className="text-lg font-semibold">{t("app.title")}</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavButton
            active={view.name !== "settings"}
            onClick={() => {
              setView({ name: "collection" });
              setSelected(null);
            }}
          >
            <Headphones size={15} />
            {t("nav.collection")}
          </NavButton>
          <NavButton
            active={view.name === "settings"}
            onClick={() => setView({ name: "settings" })}
          >
            <Settings size={15} />
            {t("nav.settings")}
          </NavButton>
        </nav>
        <div className="ml-auto">
          <button
            className="flex items-center gap-2 rounded bg-tm-accent px-3 py-1.5 text-sm font-medium text-tm-darker transition hover:bg-tm-blue"
            onClick={() => setFormState({ open: true, device: null })}
          >
            <Plus size={16} />
            {t("actions.addDevice")}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {view.name === "settings" ? (
          <SettingsView
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        ) : view.name === "device" && selected ? (
          <DeviceDetailView
            device={selected}
            settings={settings}
            onBack={() => {
              setView({ name: "collection" });
              setSelected(null);
            }}
            onEdit={() => setFormState({ open: true, device: selected })}
            onDelete={() => setDeleteTarget(selected)}
          />
        ) : (
          <CollectionView
            devices={devices}
            settings={settings}
            onOpenDevice={openDevice}
            onAddDevice={() => setFormState({ open: true, device: null })}
            onEditDevice={(d) => setFormState({ open: true, device: d })}
            onDeleteDevice={(d) => setDeleteTarget(d)}
          />
        )}
      </main>

      {formState.open && (
        <DeviceFormDialog
          device={formState.device}
          settings={settings}
          onClose={() => setFormState({ open: false, device: null })}
          onSaved={handleSaved}
        />
      )}

      {deleteTarget && (
        <Modal
          title={t("delete.title")}
          onClose={() => setDeleteTarget(null)}
          maxWidthClass="max-w-md"
          footer={
            <>
              <button
                className={btnSecondary}
                onClick={() => setDeleteTarget(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className={btnDanger}
                onClick={() => void confirmDelete()}
              >
                {t("common.delete")}
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-tm-gray">
            {t("delete.confirm", {
              name: `${deleteTarget.brand} ${deleteTarget.model}`,
            })}
            {(deleteTarget.image_path || deleteTarget.mood_image_path || deleteTarget.fr_graph_path) && (
              <> {t("delete.mediaNote")}</>
            )}{" "}
            {t("delete.unundoable")}
          </p>
        </Modal>
      )}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cls(
        "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition",
        active
          ? "bg-tm-dark text-tm-fg"
          : "text-tm-gray hover:bg-tm-dark/50 hover:text-tm-fg",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
