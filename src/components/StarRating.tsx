import { useState } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cls } from "../ui";

const DEFAULT_STAR_SIZE = 24;

/**
 * Five-star rating with half-star support (values in 0.5 steps, 0.5–5).
 * Interactive when `onChange` is provided: each star exposes two hit zones
 * (left half → x.5, right half → x.0), hovering previews, and clicking the
 * currently selected half clears the rating. Read-only otherwise.
 */
export function StarRating({
  value,
  onChange,
  size = DEFAULT_STAR_SIZE,
  showValue = true,
  className,
}: {
  /** Rating in 0.5 steps (0.5–5), or null when unrated. */
  value: number | null;
  onChange?: (value: number | null) => void;
  /** Icon size in px (default 24). */
  size?: number;
  /** Show the "n/5" text after the stars (default true). */
  showValue?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  const setAt = (v: number) => {
    if (!onChange) return;
    // Clicking the active half again clears the rating.
    onChange(value === v ? null : v);
  };

  return (
    <div
      className={cls("flex items-center", className)}
      role={onChange ? "radiogroup" : "img"}
      aria-label={
        value != null ? `${t("fields.rating")}: ${value}/5` : t("fields.rating")
      }
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, shown - (i - 1)));
        return (
          <span
            key={i}
            className="relative inline-block"
            style={{ width: size, height: size }}
          >
            <Star size={size} className="text-tm-dark" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star
                size={size}
                className="text-tm-accent"
                fill="currentColor"
                strokeWidth={0}
              />
            </span>
            {onChange && (
              <span className="absolute inset-0 flex">
                <button
                  type="button"
                  role="radio"
                  aria-checked={value === i - 0.5}
                  aria-label={t("form.starAria", { n: i - 0.5 })}
                  className="h-full w-1/2 cursor-pointer"
                  onMouseEnter={() => setHover(i - 0.5)}
                  onClick={() => setAt(i - 0.5)}
                />
                <button
                  type="button"
                  role="radio"
                  aria-checked={value === i}
                  aria-label={
                    value === i
                      ? t("form.starClearAria")
                      : t("form.starAria", { n: i })
                  }
                  className="h-full w-1/2 cursor-pointer"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setAt(i)}
                />
              </span>
            )}
          </span>
        );
      })}
      {showValue && value != null && (
        <span className="ml-1.5 text-xs text-tm-gray">{value}/5</span>
      )}
    </div>
  );
}
