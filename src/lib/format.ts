import type { DateFormat } from "./settings";

const priceFormatters = new Map<string, Intl.NumberFormat>();

function priceFormatter(
  locale: string,
  currency: string,
): Intl.NumberFormat | null {
  const key = `${locale}:${currency}`;
  const existing = priceFormatters.get(key);
  if (existing) return existing;
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return null; // unknown currency code
  }
  priceFormatters.set(key, fmt);
  return fmt;
}

/** Currency symbol for display in labels, e.g. `EUR` → `€`. */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency; // unknown currency code
  }
}

/** Format a price in the given ISO 4217 currency and locale, e.g. `299` + `EUR` + `de-DE` → `299 €`. */
export function formatPrice(
  value: number | null,
  currency: string,
  locale: string,
): string | null {
  if (value == null) return null;
  const fmt = priceFormatter(locale, currency);
  return fmt ? fmt.format(value) : String(value);
}

/**
 * Format a stored date using the selected display format. Accepts ISO dates
 * (`YYYY-MM-DD`) and ISO timestamps (formats the date part); non-ISO values
 * are returned unchanged.
 */
export function formatDate(
  value: string | null,
  format: DateFormat,
): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, year, month, day] = m;
  switch (format) {
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * Parse a date typed in the selected display format into an ISO date
 * (`YYYY-MM-DD`). Returns null for empty or invalid text. ISO input
 * (`YYYY-MM-DD`) is accepted regardless of the configured format (e.g.
 * pasted values).
 */
export function parseDateToISO(
  value: string,
  format: DateFormat,
): string | null {
  const t = value.trim();
  if (t === "") return null;
  const m =
    format === "YYYY-MM-DD"
      ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
      : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const nums = [Number(m[1]), Number(m[2]), Number(m[3])];
  let year: number;
  let month: number;
  let day: number;
  if (format === "YYYY-MM-DD") {
    [year, month, day] = nums;
  } else if (format === "MM/DD/YYYY") {
    [month, day, year] = nums;
  } else {
    [day, month, year] = nums;
  }
  // Date.UTC rolls over out-of-range months/days — verify the round trip.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
