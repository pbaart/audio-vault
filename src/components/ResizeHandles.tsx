import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isCsd } from "./TitleBar";

/** Directions accepted by Window.startResizeDragging. */
type Direction =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

/**
 * Invisible edge/corner strips that make the undecorated (CSD) window
 * resizable on Linux. Tauri's injected script only handles dragging
 * (data-tauri-drag-region); with decorations disabled the compositor
 * provides no resize borders, so each strip starts a native resize
 * operation on mousedown that runs until mouseup.
 *
 * The right strip is slightly wider than the others because the content
 * scrollbar sits at the window's right edge. The high z-index keeps the
 * strips above all app content (including modals), so an edge is always
 * grabbable.
 */
export function ResizeHandles() {
  if (!isCsd()) return null;
  const win = getCurrentWindow();

  const start = (dir: Direction) => (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    void win.startResizeDragging(dir);
  };

  const base = "fixed z-[200] select-none";

  return (
    <>
      <div
        className={`${base} inset-x-0 top-0 h-1.5 cursor-n-resize`}
        onMouseDown={start("North")}
      />
      <div
        className={`${base} inset-x-0 bottom-0 h-1.5 cursor-s-resize`}
        onMouseDown={start("South")}
      />
      <div
        className={`${base} inset-y-0 left-0 w-1.5 cursor-w-resize`}
        onMouseDown={start("West")}
      />
      <div
        className={`${base} inset-y-0 right-0 w-2.5 cursor-e-resize`}
        onMouseDown={start("East")}
      />
      <div
        className={`${base} left-0 top-0 h-3 w-3 cursor-nw-resize`}
        onMouseDown={start("NorthWest")}
      />
      <div
        className={`${base} right-0 top-0 h-3 w-3 cursor-ne-resize`}
        onMouseDown={start("NorthEast")}
      />
      <div
        className={`${base} bottom-0 left-0 h-3 w-3 cursor-sw-resize`}
        onMouseDown={start("SouthWest")}
      />
      <div
        className={`${base} bottom-0 right-0 h-3 w-3 cursor-se-resize`}
        onMouseDown={start("SouthEast")}
      />
    </>
  );
}
