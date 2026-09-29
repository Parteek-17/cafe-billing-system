/**
 * The café business day.
 *
 * The architecture is explicit that the server decides this, not the device
 * clock, so that an order at 00:20 still belongs to the previous day's
 * takings. The schema's orders.business_date has no DEFAULT precisely so that
 * this module is the only place the rule lives.
 *
 * Both values are configurable in .env.local.
 */

// Public, because the same formatting helpers run in client components. A
// timezone is not a secret. The day-start cutoff is only ever applied on the
// server, so it stays private.
const TIMEZONE = process.env.NEXT_PUBLIC_CAFE_TIMEZONE ?? "Asia/Kolkata";
const DAY_START_HOUR = Number(process.env.CAFE_DAY_START_HOUR ?? "5");

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  // Some runtimes report midnight as hour "24".
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
  };
}

/** The business date that "now" falls into, as 'YYYY-MM-DD'. */
export function currentBusinessDate(now: Date = new Date()): string {
  const { year, month, day, hour } = zonedParts(now, TIMEZONE);

  let stamp = Date.UTC(year, month - 1, day);
  if (hour < DAY_START_HOUR) {
    stamp -= 24 * 60 * 60 * 1000;
  }

  return new Date(stamp).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' for a plain calendar date, used to seed date pickers. */
export function toDateInput(date: Date): string {
  const { year, month, day } = zonedParts(date, TIMEZONE);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Human-friendly time for receipts and lists. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const CAFE_TIMEZONE = TIMEZONE;
