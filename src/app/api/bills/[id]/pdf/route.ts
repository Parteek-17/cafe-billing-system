import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureBillPdf } from "@/lib/bill-pdf";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bills/:id/pdf
 *
 * Renders the receipt, stores it at bills/YYYY-MM/BILL-NO.pdf and returns a
 * signed link — a long unguessable URL, so no customer can browse to anyone
 * else's bill.
 *
 * Pass { "force": true } to re-render a receipt that already exists.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: billId } = await params;
    const { userId, profile } = await requireUser();
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);

    const admin = createAdminClient();

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("*")
      .eq("id", billId)
      .maybeSingle<Order>();

    if (orderError) throw new HttpError(500, orderError.message);
    if (!order) throw new HttpError(404, "Bill not found.");

    // Staff may only touch bills they handled; the owner sees everything.
    const isOwnBill = order.opened_by === userId || order.settled_by === userId;
    if (profile.role !== "admin" && !isOwnBill) {
      throw new HttpError(403, "You can only open your own bills.");
    }

    const pdf = await ensureBillPdf(admin, order, { force: body.force === true });

    return Response.json({ path: pdf.path, url: pdf.url });
  } catch (err) {
    return errorResponse(err);
  }
}
