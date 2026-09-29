import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentBusinessDate } from "@/lib/business-date";
import { normalisePhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tabs — open a new tab.
 *
 * Safe to retry: local_uuid is UNIQUE, so replaying the same request returns
 * the tab that already exists instead of creating a second one.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser();
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);

    const customerName =
      typeof body.customer_name === "string" ? body.customer_name.trim() : "";
    const customerPhone = normalisePhone(
      typeof body.customer_phone === "string" ? body.customer_phone : null,
    );

    if (!customerName && !customerPhone) {
      throw new HttpError(400, "Give the tab a customer name or a phone number.");
    }

    const localUuid =
      typeof body.local_uuid === "string" && body.local_uuid.length > 0
        ? body.local_uuid
        : randomUUID();

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("orders")
      .insert({
        local_uuid: localUuid,
        customer_name: customerName || null,
        customer_phone: customerPhone,
        status: "open",
        opened_by: userId,
        business_date: currentBusinessDate(),
      })
      .select("*")
      .single();

    if (error) {
      // 23505 = unique violation on local_uuid: this request already
      // succeeded once. Return the existing tab rather than failing.
      if (error.code === "23505") {
        const { data: existing } = await admin
          .from("orders")
          .select("*")
          .eq("local_uuid", localUuid)
          .maybeSingle();

        if (existing) return Response.json({ order: existing });
      }
      throw new HttpError(400, error.message);
    }

    return Response.json({ order: data }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
