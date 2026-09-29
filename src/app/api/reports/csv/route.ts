import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { paiseToPlain } from "@/lib/money";
import type { Order, Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Wraps a field so commas, quotes and newlines cannot break the columns. */
function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * GET /api/reports/csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 * The same date range as the register, as a spreadsheet file for an accountant.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";

    if (!DATE.test(from) || !DATE.test(to)) {
      throw new HttpError(400, "Provide from and to dates as YYYY-MM-DD.");
    }
    if (from > to) throw new HttpError(400, "The start date is after the end date.");

    const admin = createAdminClient();

    const { data: rows, error } = await admin
      .from("orders")
      .select("*")
      .gte("business_date", from)
      .lte("business_date", to)
      .neq("status", "open")
      .order("business_date", { ascending: true })
      .order("bill_no", { ascending: true });

    if (error) throw new HttpError(500, error.message);

    const orders = (rows ?? []) as Order[];

    const { data: staffRows } = await admin.from("profiles").select("id, name");
    const staffNames = Object.fromEntries(
      ((staffRows ?? []) as Pick<Profile, "id" | "name">[]).map((s) => [s.id, s.name]),
    );

    const header = [
      "business_date",
      "bill_no",
      "settled_at",
      "status",
      "customer_name",
      "customer_phone",
      "subtotal",
      "discount",
      "gst",
      "total",
      "payment_mode",
      "staff",
    ];

    const lines = [
      header.join(","),
      ...orders.map((order) =>
        [
          order.business_date,
          order.bill_no,
          order.settled_at,
          order.status,
          order.customer_name,
          order.customer_phone,
          paiseToPlain(order.subtotal_paise),
          paiseToPlain(order.discount_paise),
          paiseToPlain(order.tax_paise),
          paiseToPlain(order.total_paise),
          order.payment_mode,
          order.settled_by ? (staffNames[order.settled_by] ?? "") : "",
        ]
          .map(csvCell)
          .join(","),
      ),
    ];

    // The BOM makes Excel open UTF-8 correctly on Windows.
    const body = `﻿${lines.join("\r\n")}\r\n`;

    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-${from}-to-${to}.csv"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
