import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allocateBillNo } from "@/lib/bill-number";
import { computeTotals } from "@/lib/totals";
import { writeAudit } from "@/lib/audit";
import { normalisePhone } from "@/lib/phone";
import type {
  AppSettings,
  DiscountType,
  Order,
  OrderItem,
  PaymentMode,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card"];

/**
 * POST /api/tabs/:id/settle — the most important operation in the system.
 *
 * Re-reads the tab from the database and computes subtotal → discount → GST →
 * total HERE. Whatever total the browser sent is ignored. Then it claims the
 * next bill number and marks the bill settled with the date, time and staff
 * member.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next 15+ delivers route params as a Promise.
    const { id: orderId } = await params;
    const { userId, profile } = await requireUser();
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const admin = createAdminClient();

    // ---- 1. re-read the tab ------------------------------------------------
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle<Order>();

    if (orderError) throw new HttpError(500, orderError.message);
    if (!order) throw new HttpError(404, "Tab not found.");
    if (order.status !== "open") {
      throw new HttpError(409, `This tab is already ${order.status}.`);
    }
    if (profile.role !== "admin" && order.opened_by !== userId) {
      throw new HttpError(403, "You can only settle tabs you opened.");
    }

    const { data: itemRows, error: itemsError } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);

    if (itemsError) throw new HttpError(500, itemsError.message);

    const lines = (itemRows ?? []) as OrderItem[];
    if (lines.length === 0) {
      throw new HttpError(400, "Add at least one item before settling.");
    }

    // ---- 2. validate what the browser is allowed to choose -----------------
    const paymentMode = body.payment_mode as PaymentMode;
    if (!PAYMENT_MODES.includes(paymentMode)) {
      throw new HttpError(400, "Choose a payment mode: cash, UPI or card.");
    }

    let discountType: DiscountType | null = null;
    let discountValue: number | null = null;

    if (body.discount_type === "flat" || body.discount_type === "percent") {
      const value = Number(body.discount_value);
      if (!Number.isFinite(value) || value < 0) {
        throw new HttpError(400, "The discount must be zero or more.");
      }
      if (body.discount_type === "percent" && value > 100) {
        throw new HttpError(400, "A percentage discount cannot be more than 100%.");
      }
      if (value > 0) {
        discountType = body.discount_type;
        discountValue = value;
      }
    }

    const customerName =
      (typeof body.customer_name === "string" && body.customer_name.trim()) ||
      order.customer_name ||
      null;

    const customerPhone =
      normalisePhone(
        typeof body.customer_phone === "string" ? body.customer_phone : null,
      ) ?? normalisePhone(order.customer_phone);

    if (!customerName && !customerPhone) {
      throw new HttpError(400, "A bill needs a customer name or phone number.");
    }

    // ---- 3. GST mode and bill prefix come from settings, not the browser ---
    const { data: settings } = await admin
      .from("app_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle<AppSettings>();

    if (!settings) {
      throw new HttpError(
        400,
        "There is no row in app_settings. Fill in the Settings screen before billing.",
      );
    }

    // ---- 4. the numbers, computed on the server ----------------------------
    const totals = computeTotals(lines, discountType, discountValue, settings.gst_mode);

    // ---- 5. match or create the customer -----------------------------------
    let customerId = order.customer_id;

    if (customerPhone) {
      const { data: existingCustomer } = await admin
        .from("customers")
        .select("id")
        .eq("phone", customerPhone)
        .maybeSingle<{ id: string }>();

      if (existingCustomer) {
        customerId = existingCustomer.id;
        if (customerName) {
          await admin
            .from("customers")
            .update({ name: customerName })
            .eq("id", existingCustomer.id);
        }
      } else {
        const { data: createdCustomer } = await admin
          .from("customers")
          .insert({ phone: customerPhone, name: customerName })
          .select("id")
          .maybeSingle<{ id: string }>();

        customerId = createdCustomer?.id ?? null;
      }
    }

    // ---- 6. claim the bill number ------------------------------------------
    const { billNo } = await allocateBillNo(
      admin,
      order.business_date,
      settings.bill_prefix,
    );

    // ---- 7. write the settled bill -----------------------------------------
    // The .eq("status", "open") makes this a compare-and-swap: if another
    // request settled this tab a moment ago, zero rows match and we stop.
    const { data: settledRows, error: settleError } = await admin
      .from("orders")
      .update({
        status: "settled",
        bill_no: billNo,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        discount_type: discountType,
        discount_value: discountValue,
        subtotal_paise: totals.subtotal_paise,
        discount_paise: totals.discount_paise,
        tax_paise: totals.tax_paise,
        total_paise: totals.total_paise,
        payment_mode: paymentMode,
        settled_by: userId,
        settled_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "open")
      .select("*");

    if (settleError) throw new HttpError(400, settleError.message);

    const settled = settledRows?.[0] as Order | undefined;
    if (!settled) {
      throw new HttpError(409, "This tab was settled by someone else a moment ago.");
    }

    await writeAudit(admin, {
      actor: userId,
      action: "settle",
      entity: "orders",
      entity_id: settled.id,
      before: { status: "open", subtotal_paise: order.subtotal_paise },
      after: {
        bill_no: settled.bill_no,
        discount_type: settled.discount_type,
        discount_value: settled.discount_value,
        discount_paise: settled.discount_paise,
        tax_paise: settled.tax_paise,
        total_paise: settled.total_paise,
        payment_mode: settled.payment_mode,
      },
    });

    return Response.json({ order: settled });
  } catch (err) {
    return errorResponse(err);
  }
}
