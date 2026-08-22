import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AudioLines, Copy, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isTauri } from "../lib/paths";
import { Tip } from "./Tip";
import { cls } from "../ui";

/**
 * True when we draw our own window chrome: on Linux the native frame is
 * disabled (tauri.linux.conf.json) because KWin/GNOME title bars follow
 * the system theme, not the app's active color scheme.
 */
export function isCsd(): boolean {
  return isTauri() && /Linux/.test(navigator.userAgent);
}

/**
 * Unified title bar shown instead of the native frame + separate header
 * on Linux: app identity on the left, optional children (the nav) in the
 * middle, window controls on the right. Styled with the app's CSS
 * variables so it always matches the active color scheme.
 *
 * data-tauri-drag-region="deep" makes the whole bar draggable (a bare
 * attribute would only react to clicks on the element itself); clickable
 * children (nav + window buttons) still work normally, and double-click
 * toggles maximize via Tauri's injected drag script.
 */
export function TitleBar({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    win
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    win
      .onResized(() => {
        win
          .isMaximized()
          .then(setMaximized)
          .catch(() => {});
      })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [win]);

  // Window controls: no hover background — only the icon changes color.
  // Tooltips use the app's standard Tip component (bottom side, since the
  // bar sits at the top edge of the window).
  const btn =
    "flex h-7 w-9 items-center justify-center text-tm-gray transition hover:text-tm-fg";

  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-11 w-full shrink-0 select-none items-center gap-4 border-b border-tm-dark bg-tm-darker pl-4"
    >
      <div className="flex items-center gap-2">
        <AudioLines size={20} className="text-tm-accent" />
        <span className="text-lg font-semibold">{t("app.title")}</span>
      </div>
      {children}
      <div className="ml-auto flex items-center">
        <Tip label={t("app.minimize")} side="bottom">
          <button
            className={btn}
            onClick={() => void win.minimize()}
            aria-label={t("app.minimize")}
          >
            <Minus size={14} />
          </button>
        </Tip>
        <Tip
          label={maximized ? t("app.restore") : t("app.maximize")}
          side="bottom"
        >
          <button
            className={btn}
            onClick={() => void (maximized ? win.unmaximize() : win.maximize())}
            aria-label={maximized ? t("app.restore") : t("app.maximize")}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
        </Tip>
        <Tip label={t("app.close")} side="bottom">
          <button
            className={cls(btn, "hover:text-tm-red")}
            onClick={() => void win.close()}
            aria-label={t("app.close")}
          >
            <X size={15} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
