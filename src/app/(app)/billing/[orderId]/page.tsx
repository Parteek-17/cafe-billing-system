"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/lib/api";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { computeTotals } from "@/lib/totals";
import { useApp } from "@/components/app-shell";
import type {
  Category,
  DiscountType,
  MenuItem,
  Order,
  OrderItem,
  PaymentMode,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  SectionTitle,
  Select,
  Spinner,
  cx,
} from "@/components/ui";

/**
 * One tab: add items, change quantities, then settle.
 *
 * The totals shown here are a PREVIEW computed with the same function the
 * server uses. The figures that get stored are recomputed server-side at
 * settle time and may differ if the menu changed underneath.
 */
export default function TabDetailPage() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const { settings } = useApp();

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  // settle form
  const [discountKind, setDiscountKind] = useState<"none" | DiscountType>("none");
  const [discountInput, setDiscountInput] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const [orderRes, itemsRes, catRes, menuRes] = await Promise.all([
        supabase.from("orders").select("*").eq("id", orderId).maybeSingle<Order>(),
        supabase
          .from("order_items")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true }),
        supabase.from("categories").select("*").order("sort_order", { ascending: true }),
        supabase
          .from("menu_items")
          .select("*")
          .eq("status", "active")
          .eq("is_available", true)
          .order("sort_order", { ascending: true }),
      ]);

      if (orderRes.error) throw orderRes.error;
      if (!orderRes.data) throw new Error("This tab does not exist, or you cannot see it.");

      setOrder(orderRes.data);
      setItems((itemsRes.data ?? []) as OrderItem[]);
      setCategories((catRes.data ?? []) as Category[]);
      setMenu((menuRes.data ?? []) as MenuItem[]);

      setCustomerName(orderRes.data.customer_name ?? "");
      setCustomerPhone(orderRes.data.customer_phone ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this tab.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** qty is absolute — 0 removes the line. */
  async function setQty(menuItemId: string, qty: number) {
    setBusyItemId(menuItemId);
    setError(null);

    try {
      const result = await postJson<{ items: OrderItem[]; subtotal_paise: number }>(
        `/api/tabs/${orderId}/items`,
        { menu_item_id: menuItemId, qty },
      );
      setItems(result.items);
      setOrder((current) =>
        current ? { ...current, subtotal_paise: result.subtotal_paise } : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the tab.");
    } finally {
      setBusyItemId(null);
    }
  }

  const qtyByMenuItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of items) {
      if (line.menu_item_id) map.set(line.menu_item_id, line.qty);
    }
    return map;
  }, [items]);

  const visibleMenu = useMemo(() => {
    const query = search.trim().toLowerCase();
    return menu.filter((item) => {
      const inCategory = activeCategory === "all" || item.category_id === activeCategory;
      const matches = query === "" || item.name.toLowerCase().includes(query);
      return inCategory && matches;
    });
  }, [menu, activeCategory, search]);

  // Preview only. The server recomputes this at settle.
  const preview = useMemo(() => {
    const value = rupeesToPaise(discountInput);
    const discountValue =
      discountKind === "none"
        ? null
        : discountKind === "flat"
          ? value
          : Number(discountInput || 0);

    return computeTotals(
      items,
      discountKind === "none" ? null : discountKind,
      discountValue,
      settings?.gst_mode ?? "exclusive",
    );
  }, [items, discountKind, discountInput, settings]);

  async function settle(event: React.FormEvent) {
    event.preventDefault();
    setSettleError(null);

    if (items.length === 0) {
      setSettleError("Add at least one item before settling.");
      return;
    }
    if (!paymentMode) {
      setSettleError("Choose how the customer is paying.");
      return;
    }
    if (!customerName.trim() && !customerPhone.trim()) {
      setSettleError("A bill needs a customer name or phone number.");
      return;
    }

    let discountValue: number | null = null;
    if (discountKind === "flat") {
      discountValue = rupeesToPaise(discountInput);
      if (discountValue === null) {
        setSettleError("Enter the discount as an amount, e.g. 50 or 49.50.");
        return;
      }
    } else if (discountKind === "percent") {
      const percent = Number(discountInput);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        setSettleError("Enter a percentage between 0 and 100.");
        return;
      }
      discountValue = percent;
    }

    setSettling(true);
    try {
      const { order: settled } = await postJson<{ order: Order }>(
        `/api/tabs/${orderId}/settle`,
        {
          payment_mode: paymentMode,
          discount_type: discountKind === "none" ? null : discountKind,
          discount_value: discountValue,
          customer_name: customerName,
          customer_phone: customerPhone,
        },
      );
      router.push(`/bills/${settled.id}`);
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : "Could not settle this tab.");
      setSettling(false);
    }
  }

  if (loading) return <Spinner label="Loading tab…" />;

  if (error && !order) {
    return (
      <div className="grid gap-4">
        <ErrorBanner message={error} onRetry={() => void load()} />
        <Button variant="secondary" onClick={() => router.push("/billing")}>
          Back to billing
        </Button>
      </div>
    );
  }

  if (!order) return null;

  if (order.status !== "open") {
    return (
      <div className="grid gap-4">
        <ErrorBanner message={`This tab is already ${order.status}.`} />
        <Button onClick={() => router.push(`/bills/${order.id}`)}>View the bill</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
      {/* ------------------------------------------------- items + menu */}
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">
              {order.customer_name || order.customer_phone}
            </h1>
            <p className="text-sm text-slate-500">Open tab</p>
          </div>
          <Button variant="secondary" onClick={() => router.push("/billing")}>
            Back
          </Button>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* current lines */}
        <Card className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              Nothing on this tab yet. Tap an item below.
            </p>
          ) : (
            items.map((line) => (
              <div key={line.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {line.name_snapshot}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPaise(line.unit_price_paise)} each
                    {Number(line.tax_rate) > 0 ? ` · GST ${line.tax_rate}%` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="secondary"
                    aria-label={`Reduce ${line.name_snapshot}`}
                    className="!min-h-[36px] !px-3"
                    disabled={!line.menu_item_id || busyItemId === line.menu_item_id}
                    onClick={() => line.menu_item_id && setQty(line.menu_item_id, line.qty - 1)}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center text-sm font-semibold">{line.qty}</span>
                  <Button
                    variant="secondary"
                    aria-label={`Add another ${line.name_snapshot}`}
                    className="!min-h-[36px] !px-3"
                    disabled={!line.menu_item_id || busyItemId === line.menu_item_id}
                    onClick={() => line.menu_item_id && setQty(line.menu_item_id, line.qty + 1)}
                  >
                    +
                  </Button>
                </div>

                <p className="w-20 shrink-0 text-right text-sm font-semibold">
                  {formatPaise(line.line_total_paise)}
                </p>
              </div>
            ))
          )}
        </Card>

        {/* menu grid */}
        <div className="grid gap-3">
          <SectionTitle>Add items</SectionTitle>

          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            aria-label="Search the menu"
          />

          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setActiveCategory("all")}
              className={cx(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
                activeCategory === "all"
                  ? "bg-brand text-white"
                  : "bg-white text-slate-600 border border-slate-200",
              )}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={cx(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
                  activeCategory === category.id
                    ? "bg-brand text-white"
                    : "bg-white text-slate-600 border border-slate-200",
                )}
              >
                {category.name}
              </button>
            ))}
          </div>

          {visibleMenu.length === 0 ? (
            <EmptyState>
              No published items match. Items must be <strong>Active</strong> and in stock
              to appear here.
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleMenu.map((item) => {
                const inTab = qtyByMenuItem.get(item.id) ?? 0;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => setQty(item.id, inTab + 1)}
                      disabled={busyItemId === item.id}
                      className={cx(
                        "h-full w-full rounded-xl border p-3 text-left transition disabled:opacity-50",
                        inTab > 0
                          ? "border-brand bg-brand-tint"
                          : "border-slate-200 bg-white hover:border-brand",
                      )}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {item.name}
                        </span>
                        {inTab > 0 && <Badge tone="green">{inTab}</Badge>}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {formatPaise(item.price_paise)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- settle */}
      <Card className="p-4 lg:sticky lg:top-16">
        <SectionTitle>Settle</SectionTitle>

        <form onSubmit={settle} className="mt-3 grid gap-3" noValidate>
          <Field label="Customer name" htmlFor="settle-name">
            <Input
              id="settle-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Phone" htmlFor="settle-phone">
            <Input
              id="settle-phone"
              type="tel"
              inputMode="numeric"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Discount" htmlFor="discount-kind">
            <div className="flex gap-2">
              <Select
                id="discount-kind"
                value={discountKind}
                onChange={(e) => setDiscountKind(e.target.value as "none" | DiscountType)}
                className="!w-auto flex-1"
              >
                <option value="none">None</option>
                <option value="flat">Flat ₹</option>
                <option value="percent">Percent %</option>
              </Select>

              {discountKind !== "none" && (
                <Input
                  aria-label="Discount value"
                  inputMode="decimal"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  placeholder={discountKind === "percent" ? "10" : "50.00"}
                  className="flex-1"
                />
              )}
            </div>
          </Field>

          <Field label="Payment mode" htmlFor="payment-mode">
            <Select
              id="payment-mode"
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              required
            >
              <option value="">Choose…</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
            </Select>
          </Field>

          <dl className="mt-1 grid gap-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd>{formatPaise(preview.subtotal_paise)}</dd>
            </div>
            {preview.discount_paise > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Discount</dt>
                <dd>− {formatPaise(preview.discount_paise)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">
                GST{settings?.gst_mode === "inclusive" ? " (included)" : ""}
              </dt>
              <dd>{formatPaise(preview.tax_paise)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatPaise(preview.total_paise)}</dd>
            </div>
          </dl>

          {settleError && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {settleError}
            </p>
          )}

          <Button type="submit" block disabled={settling}>
            {settling ? "Settling…" : "Settle bill"}
          </Button>

          <p className="text-xs text-slate-500">
            The final amount is recalculated on the server from the saved lines.
          </p>
        </form>
      </Card>
    </div>
  );
}
