import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderReceiptPdf } from "@/components/pdf/documents";
import type { AppSettings, Order, OrderItem, Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A signed link lasts a week — long enough for the customer to open it. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * POST /api/bills/:id/pdf
 *
 * Renders the receipt, stores it at bills/YYYY-MM/BILL-NO.pdf and returns a
 * signed link — a long unguessable URL, so no customer can browse to anyone
 * else's bill.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next 15+ delivers route params as a Promise.
    const { id: billId } = await params;
    const { userId, profile } = await requireUser();
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

    if (order.status === "open" || !order.bill_no) {
      throw new HttpError(400, "Settle the tab before generating a PDF.");
    }

    const [{ data: items }, { data: settings }, { data: staff }] = await Promise.all([
      admin.from("order_items").select("*").eq("order_id", order.id),
      admin.from("app_settings").select("*").eq("id", 1).maybeSingle<AppSettings>(),
      order.settled_by
        ? admin
            .from("profiles")
            .select("name")
            .eq("id", order.settled_by)
            .maybeSingle<Pick<Profile, "name">>()
        : Promise.resolve({ data: null }),
    ]);

    if (!settings) throw new HttpError(400, "There is no row in app_settings.");

    const buffer = await renderReceiptPdf({
      order,
      items: (items ?? []) as OrderItem[],
      settings,
      staffName: staff?.name ?? "—",
    });

    // bill_no contains slashes (CAFE/2026-09-16/007) which would become
    // folders in storage, so flatten it for the filename.
    const fileName = `${order.bill_no.replace(/[^\w.-]+/g, "-")}.pdf`;
    const path = `${order.business_date.slice(0, 7)}/${fileName}`;

    const { error: uploadError } = await admin.storage
      .from("bills")
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      throw new HttpError(
        500,
        `Could not upload the PDF: ${uploadError.message}. Check that the private "bills" bucket exists.`,
      );
    }

    await admin.from("orders").update({ pdf_path: path }).eq("id", order.id);

    const { data: signed, error: signError } = await admin.storage
      .from("bills")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed) {
      throw new HttpError(500, "The PDF was stored but no signed link could be created.");
    }

    return Response.json({ path, url: signed.signedUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
