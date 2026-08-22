import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cls } from "../ui";

const DEFAULT_DOT_SIZE = 16;

/**
 * Five-dot rating with half-dot support (values in 0.5 steps, 0.5–5).
 * Interactive when `onChange` is provided: each dot exposes two hit zones
 * (left half → x.5, right half → x.0), hovering previews, and clicking the
 * currently selected half clears the rating. Read-only otherwise.
 */
export function DotRating({
    value,
    onChange,
    size = DEFAULT_DOT_SIZE,
    showValue = true,
    label,
    className,
}: {
    /** Rating in 0.5 steps (0.5–5), or null when unrated. */
    value: number | null;
    onChange?: (value: number | null) => void;
    /** Dot diameter in px (default 16). */
    size?: number;
    /** Show the "n/5" text after the dots (default true). */
    showValue?: boolean;
    /** Accessible name of this rating (e.g. the attribute label). */
    label?: string;
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
            className={cls("flex items-center gap-1", className)}
            role={onChange ? "radiogroup" : "img"}
            aria-label={
                label == null
                    ? undefined
                    : value == null
                      ? label
                      : `${label}: ${value}/5`
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
                        <span className="absolute inset-0 rounded-full bg-tm-dark" />
                        <span
                            className="absolute inset-y-0 left-0 overflow-hidden"
                            style={{ width: `${fill * 100}%` }}
                        >
                            <span
                                className="block h-full rounded-full bg-tm-accent"
                                style={{ width: size }}
                            />
                        </span>
                        {onChange && (
                            <span className="absolute inset-0 flex">
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={value === i - 0.5}
                                    aria-label={t("form.starAria", {
                                        n: i - 0.5,
                                    })}
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
                <span className="ml-0.5 text-xs text-tm-gray">{value}/5</span>
            )}
        </div>
    );
}
