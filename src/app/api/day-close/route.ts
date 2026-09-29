import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentBusinessDate } from "@/lib/business-date";
import { writeAudit } from "@/lib/audit";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/day-close — freeze a business date.
 *
 * Afterwards bills from that date cannot be edited or voided. That is
 * enforced by a database trigger, so it holds even if someone calls the
 * database directly.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAdmin();
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);

    const businessDate =
      typeof body.business_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.business_date)
        ? body.business_date
        : currentBusinessDate();

    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("day_closes")
      .select("business_date")
      .eq("business_date", businessDate)
      .maybeSingle();

    if (existing) {
      throw new HttpError(409, `${businessDate} has already been closed.`);
    }

    const { data: openTabs } = await admin
      .from("orders")
      .select("id")
      .eq("business_date", businessDate)
      .eq("status", "open");

    if (openTabs && openTabs.length > 0) {
      throw new HttpError(
        400,
        `There ${openTabs.length === 1 ? "is" : "are"} still ${openTabs.length} open tab${
          openTabs.length === 1 ? "" : "s"
        } for ${businessDate}. Settle or remove them before closing the day.`,
      );
    }

    // Only settled bills count towards the drawer. Voided ones stay visible
    // in the records but contribute nothing.
    const { data: rows, error } = await admin
      .from("orders")
      .select("*")
      .eq("business_date", businessDate)
      .eq("status", "settled");

    if (error) throw new HttpError(500, error.message);

    const settled = (rows ?? []) as Order[];
    const sumFor = (mode: string) =>
      settled
        .filter((order) => order.payment_mode === mode)
        .reduce((sum, order) => sum + order.total_paise, 0);

    const summary = {
      business_date: businessDate,
      closed_by: userId,
      bill_count: settled.length,
      cash_paise: sumFor("cash"),
      upi_paise: sumFor("upi"),
      card_paise: sumFor("card"),
      total_paise: settled.reduce((sum, order) => sum + order.total_paise, 0),
    };

    const { data: closed, error: closeError } = await admin
      .from("day_closes")
      .insert(summary)
      .select("*")
      .single();

    if (closeError) throw new HttpError(400, closeError.message);

    await writeAudit(admin, {
      actor: userId,
      action: "day_close",
      entity: "day_closes",
      entity_id: null,
      after: summary,
    });

    return Response.json({ day_close: closed });
  } catch (err) {
    return errorResponse(err);
  }
}
