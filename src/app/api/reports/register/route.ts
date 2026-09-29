import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderRegisterPdf } from "@/components/pdf/documents";
import type { AppSettings, Order, Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

/**
 * POST /api/reports/register — the owner's record document.
 *
 * A date-range PDF listing every bill with per-day and grand totals. Stored
 * in the private reports/ bucket and returned as a signed link.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);

    const from = typeof body.from === "string" ? body.from : "";
    const to = typeof body.to === "string" ? body.to : "";

    if (!DATE.test(from) || !DATE.test(to)) {
      throw new HttpError(400, "Provide from and to dates as YYYY-MM-DD.");
    }
    if (from > to) throw new HttpError(400, "The start date is after the end date.");

    const admin = createAdminClient();

    const [{ data: rows, error }, { data: settings }, { data: staffRows }] =
      await Promise.all([
        admin
          .from("orders")
          .select("*")
          .gte("business_date", from)
          .lte("business_date", to)
          .neq("status", "open")
          .order("business_date", { ascending: true })
          .order("bill_no", { ascending: true }),
        admin.from("app_settings").select("*").eq("id", 1).maybeSingle<AppSettings>(),
        admin.from("profiles").select("id, name"),
      ]);

    if (error) throw new HttpError(500, error.message);
    if (!settings) throw new HttpError(400, "There is no row in app_settings.");

    const orders = (rows ?? []) as Order[];
    if (orders.length === 0) {
      throw new HttpError(400, "There are no bills in that date range.");
    }

    const staffNames = Object.fromEntries(
      ((staffRows ?? []) as Pick<Profile, "id" | "name">[]).map((s) => [s.id, s.name]),
    );

    const buffer = await renderRegisterPdf({ settings, from, to, orders, staffNames });

    const path = `register-${from}-to-${to}.pdf`;

    const { error: uploadError } = await admin.storage
      .from("reports")
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      throw new HttpError(
        500,
        `Could not store the register: ${uploadError.message}. Check that the private "reports" bucket exists.`,
      );
    }

    const { data: signed } = await admin.storage
      .from("reports")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (!signed) throw new HttpError(500, "The register was stored but could not be signed.");

    return Response.json({ url: signed.signedUrl, bill_count: orders.length });
  } catch (err) {
    return errorResponse(err);
  }
}
