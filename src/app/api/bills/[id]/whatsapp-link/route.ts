import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/bill-pdf";
import { buildWaMeUrl, renderMessage } from "@/lib/whatsapp";
import type { AppSettings, Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bills/:id/whatsapp-link
 *
 * Builds https://wa.me/91<phone>?text=<thanks note + bill link> from the
 * saved template. Staff tap once, WhatsApp opens with the message already
 * typed, they hit send.
 *
 * All WhatsApp logic sits behind this one endpoint, so moving to an API
 * sender later changes this file and src/lib/whatsapp.ts, nothing else.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: billId } = await params;
    const { userId, profile } = await requireUser();
    const admin = createAdminClient();

    const { data: order, error } = await admin
      .from("orders")
      .select("*")
      .eq("id", billId)
      .maybeSingle<Order>();

    if (error) throw new HttpError(500, error.message);
    if (!order) throw new HttpError(404, "Bill not found.");

    const isOwnBill = order.opened_by === userId || order.settled_by === userId;
    if (profile.role !== "admin" && !isOwnBill) {
      throw new HttpError(403, "You can only send your own bills.");
    }

    if (!order.customer_phone) {
      throw new HttpError(
        400,
        "This bill has no phone number, so it cannot be sent on WhatsApp.",
      );
    }

    const { data: settings } = await admin
      .from("app_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle<AppSettings>();

    if (!settings) throw new HttpError(400, "There is no row in app_settings.");

    // A fresh signed link each time, so an old expired one is never sent.
    let billLink = "";
    if (order.pdf_path) {
      const { data: signed } = await admin.storage
        .from("bills")
        .createSignedUrl(order.pdf_path, SIGNED_URL_TTL_SECONDS);
      billLink = signed?.signedUrl ?? "";
    }

    return Response.json({
      url: buildWaMeUrl(order, settings, billLink),
      message: renderMessage(order, settings, billLink),
      has_pdf: Boolean(billLink),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
