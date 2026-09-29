import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bills/:id/void — owner only, reason required.
 *
 * Bills are never deleted. Voiding is how mistakes get fixed, so the record
 * stays honest. The reason is kept in the audit log.
 *
 * If the business date has been closed, the database trigger refuses the
 * update — that rule is enforced below the app, not just here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next 15+ delivers route params as a Promise.
    const { id: billId } = await params;
    const { userId } = await requireAdmin();
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) {
      throw new HttpError(400, "Give a reason for voiding this bill.");
    }

    const admin = createAdminClient();

    const { data: order, error } = await admin
      .from("orders")
      .select("*")
      .eq("id", billId)
      .maybeSingle<Order>();

    if (error) throw new HttpError(500, error.message);
    if (!order) throw new HttpError(404, "Bill not found.");
    if (order.status === "void") throw new HttpError(409, "This bill is already void.");
    if (order.status !== "settled") {
      throw new HttpError(400, "Only a settled bill can be voided.");
    }

    const { data: voidedRows, error: voidError } = await admin
      .from("orders")
      .update({ status: "void" })
      .eq("id", order.id)
      .eq("status", "settled")
      .select("*");

    if (voidError) {
      // The day-close trigger surfaces here.
      throw new HttpError(409, voidError.message);
    }

    const voided = voidedRows?.[0] as Order | undefined;
    if (!voided) throw new HttpError(409, "The bill changed while you were voiding it.");

    await writeAudit(admin, {
      actor: userId,
      action: "void",
      entity: "orders",
      entity_id: voided.id,
      before: { status: "settled", total_paise: order.total_paise },
      after: { status: "void", reason },
    });

    return Response.json({ order: voided });
  } catch (err) {
    return errorResponse(err);
  }
}
