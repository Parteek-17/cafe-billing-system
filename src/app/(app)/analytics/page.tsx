"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/lib/api";
import { formatPaise } from "@/lib/money";
import { toDateInput } from "@/lib/business-date";
import { useApp } from "@/components/app-shell";
import type { Order, Profile } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  SectionTitle,
  Spinner,
} from "@/components/ui";

interface ItemRow {
  qty: number;
  line_total_paise: number;
  name_snapshot: string;
  orders: { business_date: string; status: string } | null;
}

/** Owner-only. Staff cannot reach this data at all — RLS only returns their own bills. */
export default function AnalyticsPage() {
  const { isAdmin } = useApp();
  const today = toDateInput(new Date());

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const [orders, setOrders] = useState<Order[]>([]);
  const [itemRows, setItemRows] = useState<ItemRow[]>([]);
  const [staff, setStaff] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const [orderRes, itemRes, staffRes] = await Promise.all([
        supabase
          .from("orders")
          .select("*")
          .eq("status", "settled")
          .gte("business_date", from)
          .lte("business_date", to),
        // Filter on the joined orders row so only settled bills in range count.
        supabase
          .from("order_items")
          .select("qty, line_total_paise, name_snapshot, orders!inner(business_date, status)")
          .eq("orders.status", "settled")
          .gte("orders.business_date", from)
          .lte("orders.business_date", to),
        supabase.from("profiles").select("id, name"),
      ]);

      if (orderRes.error) throw orderRes.error;
      if (itemRes.error) throw itemRes.error;

      setOrders((orderRes.data ?? []) as Order[]);
      setItemRows((itemRes.data ?? []) as unknown as ItemRow[]);
      setStaff(
        Object.fromEntries(
          ((staffRes.data ?? []) as Pick<Profile, "id" | "name">[]).map((p) => [
            p.id,
            p.name,
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const total = orders.reduce((sum, order) => sum + order.total_paise, 0);
    const count = orders.length;

    const byMode = { cash: 0, upi: 0, card: 0 } as Record<string, number>;
    for (const order of orders) {
      if (order.payment_mode) byMode[order.payment_mode] += order.total_paise;
    }

    const perDay = new Map<string, number>();
    for (const order of orders) {
      perDay.set(
        order.business_date,
        (perDay.get(order.business_date) ?? 0) + order.total_paise,
      );
    }

    const perStaff = new Map<string, { total: number; count: number }>();
    for (const order of orders) {
      if (!order.settled_by) continue;
      const current = perStaff.get(order.settled_by) ?? { total: 0, count: 0 };
      current.total += order.total_paise;
      current.count += 1;
      perStaff.set(order.settled_by, current);
    }

    const perItem = new Map<string, { qty: number; total: number }>();
    for (const row of itemRows) {
      const current = perItem.get(row.name_snapshot) ?? { qty: 0, total: 0 };
      current.qty += row.qty;
      current.total += row.line_total_paise;
      perItem.set(row.name_snapshot, current);
    }

    const rankedItems = [...perItem.entries()].sort((a, b) => b[1].qty - a[1].qty);

    return {
      total,
      count,
      average: count > 0 ? Math.round(total / count) : 0,
      byMode,
      perDay: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      perStaff: [...perStaff.entries()].sort((a, b) => b[1].total - a[1].total),
      best: rankedItems.slice(0, 5),
      worst: rankedItems.slice(-5).reverse(),
    };
  }, [orders, itemRows]);

  async function downloadCsv() {
    setExportError(null);
    // A plain navigation, so the browser handles the file download.
    window.open(`/api/reports/csv?from=${from}&to=${to}`, "_blank", "noopener");
  }

  async function downloadRegister() {
    setExporting(true);
    setExportError(null);
    try {
      const { url } = await postJson<{ url: string }>("/api/reports/register", { from, to });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not build the register.");
    } finally {
      setExporting(false);
    }
  }

  if (!isAdmin) return <ErrorBanner message="Analytics is owner-only." />;

  const peak = Math.max(1, ...stats.perDay.map(([, value]) => value));

  return (
    <div className="grid gap-5">
      <div>
        <SectionTitle>Analytics</SectionTitle>
        <p className="mt-0.5 text-sm text-slate-500">Settled bills only. Voided bills are excluded.</p>
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Field label="From" htmlFor="from">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={downloadCsv}>
          Export CSV
        </Button>
        <Button variant="secondary" onClick={downloadRegister} disabled={exporting}>
          {exporting ? "Building…" : "PDF register"}
        </Button>
      </Card>

      {exportError && <ErrorBanner message={exportError} />}

      {loading && <Spinner label="Crunching the numbers…" />}
      {!loading && error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total sales" value={formatPaise(stats.total)} />
            <Kpi label="Bills" value={String(stats.count)} />
            <Kpi label="Average bill" value={formatPaise(stats.average)} />
            <Kpi
              label="Cash / UPI / Card"
              value={`${formatPaise(stats.byMode.cash)} · ${formatPaise(
                stats.byMode.upi,
              )} · ${formatPaise(stats.byMode.card)}`}
              small
            />
          </div>

          {stats.count === 0 ? (
            <EmptyState>No settled bills in this range.</EmptyState>
          ) : (
            <>
              {/* Hand-rolled bars — a chart library would be one more
                  dependency for a single view. */}
              <Card className="p-4">
                <h3 className="text-sm font-bold text-slate-900">Sales per day</h3>
                <ul className="mt-3 grid gap-2">
                  {stats.perDay.map(([day, value]) => (
                    <li key={day} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-2">
                      <span className="text-xs text-slate-500">{day}</span>
                      <span className="h-3 rounded-full bg-slate-100">
                        <span
                          className="block h-3 rounded-full bg-brand"
                          style={{ width: `${Math.max(2, (value / peak) * 100)}%` }}
                        />
                      </span>
                      <span className="text-right text-xs font-semibold">
                        {formatPaise(value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="grid gap-3 lg:grid-cols-2">
                <ItemTable title="Best sellers" rows={stats.best} />
                <ItemTable title="Slowest movers" rows={stats.worst} />
              </div>

              <Card className="p-4">
                <h3 className="text-sm font-bold text-slate-900">Sales per staff member</h3>
                <ul className="mt-3 grid gap-1.5 text-sm">
                  {stats.perStaff.map(([id, value]) => (
                    <li key={id} className="flex justify-between">
                      <span className="text-slate-600">{staff[id] ?? "—"}</span>
                      <span className="font-semibold">
                        {formatPaise(value.total)}{" "}
                        <span className="text-xs font-normal text-slate-400">
                          ({value.count} bills)
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={small ? "mt-1 text-sm font-bold" : "mt-1 text-xl font-bold"}>{value}</p>
    </Card>
  );
}

function ItemTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, { qty: number; total: number }]>;
}) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nothing to show.</p>
      ) : (
        <ul className="mt-3 grid gap-1.5 text-sm">
          {rows.map(([name, value]) => (
            <li key={name} className="flex justify-between gap-3">
              <span className="truncate text-slate-600">{name}</span>
              <span className="shrink-0 font-semibold">
                {value.qty}{" "}
                <span className="text-xs font-normal text-slate-400">
                  · {formatPaise(value.total)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
