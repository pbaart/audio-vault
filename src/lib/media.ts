import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./paths";

/**
 * Absolute media dir, set once at boot from `init_app_data`. Kept as a
 * module-level cache because `mediaSrc` is called synchronously during
 * render (the asset protocol needs absolute paths).
 */
let mediaDir: string | null = null;

export function setMediaDir(dir: string): void {
  mediaDir = dir.replace(/\/+$/, "");
}

/**
 * Build an `asset://` URL for a media-relative path. Returns null when the
 * path is missing or we are not inside a Tauri webview.
 */
function mediaSrc(relPath: string | null): string | null {
  if (!relPath || !mediaDir || !isTauri()) {
    return null;
  }
  const safe = relPath.replace(/^\/+/, "");
  return convertFileSrc(`${mediaDir}/${safe}`);
}

/** Common display sizes for cached downscaled copies (see media_scaled). */
export const IMG_SIZE_TABLE = 96;
export const IMG_SIZE_CARD = 480;
export const IMG_SIZE_HERO = 1200;

/** Memoized scaled-path results so each (relPath, size) resolves once. */
const scaledRelCache = new Map<string, string>();

/**
 * Ask the backend for a downscaled copy of a media image. The copy is
 * generated once and cached on disk under media/.cache; resolves to the
 * original path when scaling is unavailable or unneeded.
 */
export function getScaledRelPath(
  relPath: string,
  maxDim: number,
): Promise<string> {
  const key = `${maxDim}:${relPath}`;
  const hit = scaledRelCache.get(key);
  if (hit) {
    return Promise.resolve(hit);
  }
  return invoke<string>("media_scaled", { relPath, maxDim })
    .then((rel) => {
      scaledRelCache.set(key, rel);
      return rel;
    })
    .catch(() => relPath);
}

/** Open the native image picker and copy the file into the media dir. */
export async function pickImageFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
      },
    ],
  });
  if (!selected || Array.isArray(selected)) {
    return null;
  }
  return await invoke<string>("media_copy_file", { src: selected });
}

/** Delete a media file (best-effort, idempotent). */
export async function removeMediaFile(relPath: string | null): Promise<void> {
  if (!relPath) {
    return;
  }
  try {
    await invoke("media_delete", { relPath });
  } catch {
    // best effort — media cleanup must never block the main operation
  }
}

/** Open the media folder in the system file manager. */
export async function openMediaFolder(): Promise<void> {
  await invoke("open_media_folder");
}

interface MediaUrlState {
  broken: boolean;
  fallback: string | null;
}

/**
 * Resolve a media-relative path to a displayable URL.
 *
 * Primary path: the Tauri asset protocol (`convertFileSrc`), which is
 * scoped to `$APPDATA/media/**`. If the `<img>` errors (e.g. unsupported
 * asset protocol), we fall back to a base64 data URL via `media_read_base64`.
 */
export function useMediaUrl(relPath: string | null): {
  url: string | null;
  onAssetError: () => void;
} {
  const [state, setState] = useState<MediaUrlState>({
    broken: false,
    fallback: null,
  });
  const fetchingRef = useRef<string | null>(null);
  const assetUrl = mediaSrc(relPath);

  useEffect(() => {
    setState({ broken: false, fallback: null });
    fetchingRef.current = null;
  }, [relPath, assetUrl]);

  const onAssetError = useCallback(() => {
    if (!relPath || fetchingRef.current === relPath) {
      return;
    }
    fetchingRef.current = relPath;
    invoke<string>("media_read_base64", { relPath })
      .then((url) => setState({ broken: true, fallback: url }))
      .catch(() => setState({ broken: true, fallback: null }));
  }, [relPath]);

  return {
    url: state.broken ? state.fallback : assetUrl,
    onAssetError,
  };
}

/**
 * Like useMediaUrl, but optionally resolves a downscaled copy first. While
 * the first-ever scaled copy is being generated the hook reports no URL
 * (callers show their placeholder) so the full-size original is never
 * fetched for small displays. Without maxDim this behaves exactly like
 * useMediaUrl.
 */
export function useScaledMediaUrl(
  relPath: string | null,
  maxDim?: number,
): { url: string | null; onAssetError: () => void } {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!relPath) return null;
    if (!maxDim || !isTauri()) return relPath;
    return scaledRelCache.get(`${maxDim}:${relPath}`) ?? null;
  });

  useEffect(() => {
    if (!relPath) {
      setResolved(null);
      return;
    }
    if (!maxDim || !isTauri()) {
      setResolved(relPath);
      return;
    }
    let alive = true;
    const hit = scaledRelCache.get(`${maxDim}:${relPath}`);
    if (hit) {
      setResolved(hit);
    } else {
      void getScaledRelPath(relPath, maxDim).then((rel) => {
        if (alive) setResolved(rel);
      });
    }
    return () => {
      alive = false;
    };
  }, [relPath, maxDim]);

  return useMediaUrl(resolved);
}
