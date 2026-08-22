import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useMediaUrl } from "../lib/media";

interface LightboxProps {
  relPath: string | null;
  title?: string;
  onClose: () => void;
}

/** Full-screen image viewer. Closes on Escape or backdrop click. */
export function Lightbox({ relPath, title, onClose }: LightboxProps) {
  const { t } = useTranslation();
  const { url, onAssetError } = useMediaUrl(relPath);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-full max-w-full flex-col">
        <div className="mb-2 flex items-center justify-between gap-6 text-sm text-tm-fg">
          <span>{title ?? ""}</span>
          <button
            className="rounded p-1 text-tm-gray transition hover:bg-tm-dark hover:text-tm-fg"
            onClick={onClose}
            aria-label={t("common.closeViewer")}
          >
            <X size={20} />
          </button>
        </div>
        {url ? (
          <img
            src={url}
            alt={title ?? t("lightbox.image")}
            onError={onAssetError}
            className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center rounded-lg bg-tm-darker text-tm-gray">
            {t("lightbox.unavailable")}
          </div>
        )}
      </div>
    </div>
  );
}
