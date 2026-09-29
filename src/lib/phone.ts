/**
 * Phone handling.
 *
 * customers.phone is UNIQUE, so the same customer must always normalise to
 * the same string or the "match at settle" behaviour silently creates
 * duplicates. Stored form is digits only, without a country code for the
 * common 10-digit Indian number.
 */

const DEFAULT_COUNTRY_CODE = "91";

/** "+91 98765-43210" -> "9876543210". Returns null when there is no usable number. */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  let digits = input.replace(/\D/g, "");
  if (!digits) return null;

  // Drop a leading 0 (STD prefix) and a leading country code on an
  // otherwise 10-digit number, so all three spellings collapse to one.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    digits = digits.slice(DEFAULT_COUNTRY_CODE.length);
  }

  return digits.length >= 6 ? digits : null;
}

/** The form wa.me expects: country code + number, no plus, no spaces. */
export function toWhatsAppNumber(stored: string): string {
  const digits = stored.replace(/\D/g, "");
  return digits.length === 10 ? `${DEFAULT_COUNTRY_CODE}${digits}` : digits;
}

/** "9876543210" -> "+91 98765 43210" for display. */
export function formatPhone(stored: string | null): string {
  if (!stored) return "—";
  const digits = stored.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+${DEFAULT_COUNTRY_CODE} ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return stored;
}
