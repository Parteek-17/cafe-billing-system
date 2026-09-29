import type { NextRequest } from "next/server";

import { HttpError, errorResponse, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MenuItem, Order, OrderItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tabs/:id/items — add a line, change its quantity, or remove it.
 *
 * qty is ABSOLUTE, not a delta, so a retried request cannot double an order.
 * qty of 0 removes the line.
 *
 * The item's name, price and GST rate are COPIED onto the line. Raising the
 * coffee price next month must never rewrite last month's bills.
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

    const menuItemId = typeof body.menu_item_id === "string" ? body.menu_item_id : "";
    const qty = Number(body.qty);

    if (!menuItemId) throw new HttpError(400, "menu_item_id is required.");
    if (!Number.isInteger(qty) || qty < 0) {
      throw new HttpError(400, "qty must be a whole number of 0 or more.");
    }

    const admin = createAdminClient();

    // ---- the tab must be open, and yours -----------------------------------
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle<Order>();

    if (orderError) throw new HttpError(500, orderError.message);
    if (!order) throw new HttpError(404, "Tab not found.");
    if (order.status !== "open") {
      throw new HttpError(409, `This tab is already ${order.status} and cannot be changed.`);
    }
    if (profile.role !== "admin" && order.opened_by !== userId) {
      throw new HttpError(403, "You can only change tabs you opened.");
    }

    // ---- snapshot the menu item -------------------------------------------
    const { data: menuItem, error: menuError } = await admin
      .from("menu_items")
      .select("*")
      .eq("id", menuItemId)
      .maybeSingle<MenuItem>();

    if (menuError) throw new HttpError(500, menuError.message);
    if (!menuItem) throw new HttpError(404, "That menu item no longer exists.");
    if (menuItem.status !== "active") {
      throw new HttpError(400, `"${menuItem.name}" is still a draft and cannot be billed.`);
    }

    const { data: existing } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id)
      .eq("menu_item_id", menuItemId)
      .maybeSingle<OrderItem>();

    if (qty === 0) {
      if (existing) {
        const { error } = await admin.from("order_items").delete().eq("id", existing.id);
        if (error) throw new HttpError(400, error.message);
      }
    } else if (existing) {
      // Keep the original snapshot — the price at the time of ordering.
      const { error } = await admin
        .from("order_items")
        .update({
          qty,
          line_total_paise: existing.unit_price_paise * qty,
        })
        .eq("id", existing.id);
      if (error) throw new HttpError(400, error.message);
    } else {
      const { error } = await admin.from("order_items").insert({
        order_id: order.id,
        menu_item_id: menuItem.id,
        name_snapshot: menuItem.name,
        unit_price_paise: menuItem.price_paise,
        tax_rate: menuItem.tax_rate,
        qty,
        line_total_paise: menuItem.price_paise * qty,
      });
      if (error) throw new HttpError(400, error.message);
    }

    // ---- keep the running total on the tab honest --------------------------
    // This is only for the open-tab list. The authoritative figures are
    // recomputed from scratch at settle time.
    const { data: lines } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });

    const subtotal = (lines ?? []).reduce(
      (sum, line) => sum + line.line_total_paise,
      0,
    );

    await admin
      .from("orders")
      .update({ subtotal_paise: subtotal })
      .eq("id", order.id);

    return Response.json({ items: lines ?? [], subtotal_paise: subtotal });
  } catch (err) {
    return errorResponse(err);
  }
}
