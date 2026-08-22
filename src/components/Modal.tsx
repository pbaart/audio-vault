import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cls } from "../ui";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
}

/** Centered modal overlay. Closes on Escape or backdrop click. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidthClass = "max-w-2xl",
}: ModalProps) {
  const { t } = useTranslation();
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
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={cls(
          "w-full rounded-lg border border-tm-dark bg-tm-bg shadow-2xl",
          maxWidthClass,
        )}
      >
        <div className="flex items-center justify-between border-b border-tm-dark px-5 py-3">
          <h2 className="text-lg font-semibold text-tm-fg">{title}</h2>
          <button
            className="rounded p-1 text-tm-gray transition hover:bg-tm-dark hover:text-tm-fg"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-tm-dark px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
