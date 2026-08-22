import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Cpu, Headphones, Settings } from "lucide-react";
import type { Device, DeviceCategory } from "./types";
import { deleteDevice, getDevice, listDevices } from "./lib/db";
import { getAppPaths } from "./lib/paths";
import i18n, { localizeNote } from "./lib/i18n";
import { getSettings, updateSettings, type AppSettings } from "./lib/settings";
import { setTheme } from "./lib/themes";
import { removeMediaFile, setMediaDir } from "./lib/media";
import { CollectionView } from "./components/CollectionView";
import { TitleBar, isCsd } from "./components/TitleBar";
import { DeviceDetailView } from "./components/DeviceDetailView";
import { DeviceFormDialog } from "./components/DeviceFormDialog";
import { SettingsView } from "./components/SettingsView";
import { Modal } from "./components/Modal";
import { btnDanger, btnSecondary, cls } from "./ui";

type View =
  | { name: "collection"; category: DeviceCategory }
  | { name: "device"; id: string }
  | { name: "settings" };

/**
 * History entry state: mirrors the app view (plus its depth) so the
 * webview back/forward buttons — mouse back button, Alt+Left/Right —
 * navigate between collection, device detail and settings.
 */
type HistState = View & { idx: number };

function histState(): HistState {
  return (
    (window.history.state as HistState | null) ?? {
      name: "collection",
      category: "headphones",
      idx: 0,
    }
  );
}

export default function App() {
  const { t } = useTranslation();
  const csd = isCsd();
  const [booted, setBooted] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device | null>(null);
  const [view, setView] = useState<View>({ name: "collection", category: "headphones" });
  const [formState, setFormState] = useState<{
    open: boolean;
    device: Device | null;
    category: DeviceCategory;
  }>({ open: false, device: null, category: "headphones" });
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

  // Tag the initial history entry so back/forward have a baseline.
  useEffect(() => {
    window.history.replaceState(
      { name: "collection", category: "headphones", idx: 0 },
      "",
    );
  }, []);

  // Mouse back/forward (and Alt+Left/Right) navigate the app views.
  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const st = (e.state as HistState | null) ?? {
        name: "collection",
        category: "headphones",
        idx: 0,
      };
      if (st.name === "collection") {
        setView({ name: "collection", category: st.category });
        setSelected(null);
      } else if (st.name === "settings") {
        setView({ name: "settings" });
        setSelected(null);
      } else {
        void getDevice(st.id).then((d) => {
          if (d) {
            setSelected(d);
            setView({ name: "device", id: st.id });
          } else {
            // Stale entry (device deleted) — drop it.
            setView({ name: "collection", category: "headphones" });
            setSelected(null);
            window.history.replaceState(
              { name: "collection", category: "headphones", idx: 0 },
              "",
            );
          }
        });
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openDevice(id: string) {
    void getDevice(id).then((d) => {
      if (!d) return;
      setSelected(d);
      setView({ name: "device", id });
      const cur = histState();
      if (!(cur.name === "device" && cur.id === id)) {
        window.history.pushState({ name: "device", id, idx: cur.idx + 1 }, "");
      }
    });
  }

  function openSettings() {
    setView({ name: "settings" });
    const cur = histState();
    if (cur.name !== "settings") {
      window.history.pushState({ name: "settings", idx: cur.idx + 1 }, "");
    }
  }

  /** Pop one history entry (back arrow, mouse back, delete flow). */
  function goBack() {
    if (histState().idx === 0) return;
    window.history.back();
  }

  /** Navigate to a collection page, pushing a history entry. */
  function openCollection(cat: DeviceCategory) {
    const cur = histState();
    if (cur.name === "collection" && cur.category === cat) return;
    setSelected(null);
    setView({ name: "collection", category: cat });
    window.history.pushState(
      { name: "collection", category: cat, idx: cur.idx + 1 },
      "",
    );
  }

  function handleSaved(device: Device) {
    setFormState({ open: false, device: null, category: "headphones" });
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
      void removeMediaFile(d.mood_image_path);
      d.images.forEach((rel) => void removeMediaFile(rel));
      void removeMediaFile(d.fr_graph_path);
      setDeleteTarget(null);
      if (view.name === "device" && view.id === d.id) {
        goBack();
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
      <div className="flex h-screen flex-col bg-tm-bg">
        {csd && <TitleBar />}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="text-lg font-semibold text-tm-red">{t("app.error")}</h1>
          <p className="max-w-md break-all text-sm text-tm-gray">
            {localizeNote(error)}
          </p>
        </div>
      </div>
    );
  }

  if (!booted || !settings) {
    return (
      <div className="flex h-screen flex-col bg-tm-bg">
        {csd && <TitleBar />}
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-tm-gray">{t("app.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-tm-bg text-tm-fg">
      {csd && <TitleBar />}
      <header className="flex items-center gap-4 border-b border-tm-dark bg-tm-darker px-4 py-2">
        <div className="flex items-center gap-2">
          <AudioLines size={20} className="text-tm-accent" />
          <span className="text-lg font-semibold">{t("app.title")}</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavButton
            active={view.name === "collection" && view.category === "headphones"}
            onClick={() => openCollection("headphones")}
          >
            <Headphones size={15} />
            {t("nav.collection")}
          </NavButton>
          <NavButton
            active={view.name === "collection" && view.category === "devices"}
            onClick={() => openCollection("devices")}
          >
            <Cpu size={15} />
            {t("nav.devices")}
          </NavButton>
          <NavButton active={view.name === "settings"} onClick={openSettings}>
            <Settings size={15} />
            {t("nav.settings")}
          </NavButton>
        </nav>
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
            onBack={goBack}
            onEdit={() =>
              setFormState({
                open: true,
                device: selected,
                category: selected.category,
              })
            }
            onDelete={() => setDeleteTarget(selected)}
          />
        ) : view.name === "collection" ? (
          <CollectionView
            devices={devices}
            category={view.category}
            settings={settings}
            onOpenDevice={openDevice}
            onAddDevice={() =>
              setFormState({
                open: true,
                device: null,
                category: view.category,
              })
            }
            onEditDevice={(d) =>
              setFormState({ open: true, device: d, category: d.category })
            }
            onDeleteDevice={(d) => setDeleteTarget(d)}
          />
        ) : null}
      </main>

      {formState.open && (
        <DeviceFormDialog
          device={formState.device}
          category={formState.category}
          settings={settings}
          onClose={() => setFormState({ open: false, device: null, category: "headphones" })}
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
            {(deleteTarget.mood_image_path ||
              deleteTarget.fr_graph_path ||
              deleteTarget.images.length > 0) && <> {t("delete.mediaNote")}</>}{" "}
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
