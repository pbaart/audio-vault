import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Small "more info" icon next to a field label. Hovering (or clicking /
 * pressing Enter on the focused icon) opens a popover with the field's
 * Definition / Traits / Experience text. Closes on mouse leave, outside
 * click, or Escape.
 */
export function InfoTip({
  label,
  definition,
  traits,
  experience,
}: {
  /** Field name shown as the popover heading. */
  label: string;
  definition: string;
  traits: string;
  experience: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t("soundInfo.aria", { field: label })}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="cursor-help text-tm-gray transition hover:text-tm-accent"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-50 w-64 -translate-x-1/2 rounded-lg border border-tm-dark bg-tm-bg p-3 text-left shadow-xl"
        >
          <span className="block text-xs font-semibold text-tm-fg">{label}</span>
          <span className="mt-1.5 block text-xs leading-relaxed text-tm-gray">
            <span className="font-semibold uppercase tracking-wide text-tm-fg">
              {t("soundInfo.definition")}
            </span>{" "}
            {definition}
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-tm-gray">
            <span className="font-semibold uppercase tracking-wide text-tm-fg">
              {t("soundInfo.traits")}
            </span>{" "}
            {traits}
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-tm-gray">
            <span className="font-semibold uppercase tracking-wide text-tm-fg">
              {t("soundInfo.experience")}
            </span>{" "}
            {experience}
          </span>
        </span>
      )}
    </span>
  );
}
