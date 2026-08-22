import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cls } from "../ui";

interface DateCalendarProps {
  /** Selected date as ISO (`YYYY-MM-DD`), or null when none/invalid. */
  value: string | null;
  /** Called with the ISO date when a day is picked. */
  onSelect: (iso: string) => void;
  /** BCP-47 locale for month/weekday names (e.g. "de-DE"). */
  locale: string;
}

/**
 * Small calendar popover attached to a date input. The icon button opens a
 * month grid (Monday-first); clicking a day calls onSelect with the ISO
 * date and closes the popup. Closes on outside click or Escape. Month and
 * weekday names come from Intl, so they follow the app language.
 */
export function DateCalendar({ value, onSelect, locale }: DateCalendarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Initial view: month of the selected date, else the current month.
  const initial = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth()); // 0-based

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

  // Monday-first day cells for the viewed month (null = leading blanks).
  const cells = useMemo(() => {
    const lead =
      (new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(
      Date.UTC(viewYear, viewMonth + 1, 0),
    ).getUTCDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [viewYear, viewMonth]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }).format(new Date(Date.UTC(viewYear, viewMonth, 1))),
    [locale, viewYear, viewMonth],
  );

  // Reference week: Mon 2024-01-01 … Sun 2024-01-07.
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    return [1, 2, 3, 4, 5, 6, 7].map((d) =>
      fmt.format(new Date(Date.UTC(2024, 0, d))),
    );
  }, [locale]);

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const isoOf = (day: number) =>
    `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={t("form.calendarAria")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-tm-dark bg-tm-darker text-tm-gray transition hover:border-tm-accent hover:text-tm-fg"
      >
        <CalendarDays size={14} />
      </button>
      {open && (
        <span className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-tm-dark bg-tm-bg p-2 shadow-xl">
          <span className="flex items-center justify-between px-1 pb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={prevMonth}
              className="rounded p-1 text-tm-gray transition hover:bg-tm-dark hover:text-tm-fg"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-semibold text-tm-fg">
              {monthLabel}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={nextMonth}
              className="rounded p-1 text-tm-gray transition hover:bg-tm-dark hover:text-tm-fg"
            >
              <ChevronRight size={14} />
            </button>
          </span>
          <span className="grid grid-cols-7 gap-0.5">
            {weekdayNames.map((w) => (
              <span
                key={w}
                className="flex h-6 items-center justify-center text-[10px] font-semibold uppercase text-tm-gray"
              >
                {w}
              </span>
            ))}
            {cells.map((day, i) =>
              day == null ? (
                <span key={`blank-${i}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    onSelect(isoOf(day));
                    setOpen(false);
                  }}
                  className={cls(
                    "flex h-7 w-7 items-center justify-center rounded text-xs transition",
                    value === isoOf(day)
                      ? "bg-tm-accent font-semibold text-tm-darker"
                      : "text-tm-fg hover:bg-tm-dark",
                    day.toString() === todayIso.slice(-2) &&
                      isoOf(day) === todayIso &&
                      "ring-1 ring-tm-accent/60",
                  )}
                >
                  {day}
                </button>
              ),
            )}
          </span>
        </span>
      )}
    </span>
  );
}
