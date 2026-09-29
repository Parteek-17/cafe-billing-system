/**
 * Money helpers.
 *
 * Every amount in this system is a whole number of paise. Rupees only ever
 * exist as a display string or as raw form input — never as a stored value,
 * and never in arithmetic.
 */

/** 123456 -> "₹1,234.56" */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const pais = abs % 100;
  return `${sign}₹${rupees.toLocaleString("en-IN")}.${String(pais).padStart(2, "0")}`;
}

/** 123456 -> "1234.56" (for CSV and form fields, no symbol or separators) */
export function paiseToPlain(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  return `${paise < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * "12.50" -> 1250. Returns null when the text is not a usable amount, so
 * callers can show a validation message instead of writing NaN to the database.
 */
export function rupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
