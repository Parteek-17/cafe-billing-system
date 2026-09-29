import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { paiseToPlain } from "@/lib/money";
import { toWhatsAppNumber } from "@/lib/phone";
import type { AppSettings, Order } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * GET /api/bills/:id/whatsapp-link
 *
 * Builds https://wa.me/91<phone>?text=<thanks note + bill link> from the saved
 * template. Staff tap once, WhatsApp opens with the message already typed.
 *
 * All WhatsApp logic lives here, so moving to the Cloud API later changes one
 * file.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next 15+ delivers route params as a Promise.
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

    const message = settings.whatsapp_template
      .replaceAll("{{customer_name}}", order.customer_name ?? "there")
      .replaceAll("{{cafe_name}}", settings.cafe_name)
      .replaceAll("{{bill_no}}", order.bill_no ?? "")
      .replaceAll("{{total}}", `Rs. ${paiseToPlain(order.total_paise)}`)
      .replaceAll("{{bill_link}}", billLink)
      .trim();

    const url = `https://wa.me/${toWhatsAppNumber(order.customer_phone)}?text=${encodeURIComponent(message)}`;

    return Response.json({ url, message, has_pdf: Boolean(billLink) });
  } catch (err) {
    return errorResponse(err);
  }
}
