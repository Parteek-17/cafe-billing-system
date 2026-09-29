import type { DiscountType, GstMode } from "./types";

/**
 * Settle arithmetic.
 *
 * This runs on the server only. Whatever total the browser sends at settle
 * time is ignored and recomputed from the lines stored in the database.
 *
 * Everything is integer paise. The only rounding is an explicit Math.round at
 * each tax step, so the parts always add back up to the whole.
 */

export interface TotalsLine {
  tax_rate: number;
  line_total_paise: number;
}

export interface Totals {
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
}

export function computeTotals(
  lines: TotalsLine[],
  discountType: DiscountType | null,
  discountValue: number | null,
  gstMode: GstMode,
): Totals {
  const subtotal = lines.reduce((sum, line) => sum + line.line_total_paise, 0);

  // ---- discount ----------------------------------------------------------
  let discount = 0;
  if (discountType === "flat" && discountValue != null) {
    discount = Math.round(discountValue);
  } else if (discountType === "percent" && discountValue != null) {
    discount = Math.round((subtotal * discountValue) / 100);
  }
  discount = Math.min(Math.max(discount, 0), subtotal);

  // ---- tax ---------------------------------------------------------------
  // The discount is spread across the lines in proportion to their value, so
  // each line is taxed on what the customer actually paid for it. The last
  // line absorbs the rounding remainder so the shares sum to the discount
  // exactly.
  let tax = 0;
  let allocated = 0;

  lines.forEach((line, index) => {
    let share = 0;
    if (subtotal > 0 && discount > 0) {
      share =
        index === lines.length - 1
          ? discount - allocated
          : Math.round((discount * line.line_total_paise) / subtotal);
      allocated += share;
    }

    const net = line.line_total_paise - share;
    const rate = Number(line.tax_rate);
    if (rate <= 0) return;

    tax +=
      gstMode === "inclusive"
        ? Math.round((net * rate) / (100 + rate)) // tax already sits inside net
        : Math.round((net * rate) / 100); // tax is added on top
  });

  // ---- total -------------------------------------------------------------
  // Inclusive: the subtotal already contains the tax, so it is not added again.
  const total =
    gstMode === "inclusive" ? subtotal - discount : subtotal - discount + tax;

  return {
    subtotal_paise: subtotal,
    discount_paise: discount,
    tax_paise: tax,
    total_paise: total,
  };
}
