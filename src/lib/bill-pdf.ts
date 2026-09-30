import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/auth";
import { renderReceiptPdf } from "@/components/pdf/documents";
import type { AppSettings, Order, OrderItem, Profile } from "@/lib/types";

/** A signed link lasts a week — long enough for the customer to open it. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface BillPdf {
  path: string;
  url: string;
}

/**
 * Renders the receipt if it is not already stored, then returns a fresh
 * signed link.
 *
 * Shared by POST /api/bills/:id/pdf and the WhatsApp sender, so a bill can
 * never be sent with a link to a PDF that was never generated.
 *
 * The link is unguessable and time limited, which is what lets the customer
 * open their bill without the bucket ever being public.
 */
export async function ensureBillPdf(
  admin: SupabaseClient,
  order: Order,
  options: { force?: boolean } = {},
): Promise<BillPdf> {
  if (order.status === "open" || !order.bill_no) {
    throw new HttpError(400, "Settle the tab before generating a PDF.");
  }

  // bill_no contains slashes (CAFE/2026-09-16/007) which would become folders
  // in storage, so flatten it for the filename.
  const fileName = `${order.bill_no.replace(/[^\w.-]+/g, "-")}.pdf`;
  const path = order.pdf_path ?? `${order.business_date.slice(0, 7)}/${fileName}`;

  if (!order.pdf_path || options.force) {
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
  }

  const { data: signed, error: signError } = await admin.storage
    .from("bills")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    throw new HttpError(500, "The PDF was stored but no signed link could be created.");
  }

  return { path, url: signed.signedUrl };
}
