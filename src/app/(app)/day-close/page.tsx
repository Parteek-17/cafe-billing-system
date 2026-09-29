"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/lib/api";
import { formatPaise } from "@/lib/money";
import { formatDateTime, toDateInput } from "@/lib/business-date";
import { useApp } from "@/components/app-shell";
import type { DayClose, Order } from "@/lib/types";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  SectionTitle,
  Spinner,
} from "@/components/ui";

/**
 * Day close — owner only.
 *
 * Closing freezes the date. Afterwards the database refuses any edit or void
 * of a bill from that day, so this is a real lock rather than a hidden button.
 */
export default function DayClosePage() {
  const { isAdmin } = useApp();

  const [date, setDate] = useState(toDateInput(new Date()));
  const [orders, setOrders] = useState<Order[]>([]);
  const [openTabs, setOpenTabs] = useState<number>(0);
  const [closed, setClosed] = useState<DayClose | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCloseError(null);

    try {
      const supabase = createClient();

      const [settledRes, openRes, closeRes] = await Promise.all([
        supabase
          .from("orders")
          .select("*")
          .eq("business_date", date)
          .eq("status", "settled"),
        supabase
          .from("orders")
          .select("id")
          .eq("business_date", date)
          .eq("status", "open"),
        supabase
          .from("day_closes")
          .select("*")
          .eq("business_date", date)
          .maybeSingle<DayClose>(),
      ]);

      if (settledRes.error) throw settledRes.error;

      setOrders((settledRes.data ?? []) as Order[]);
      setOpenTabs((openRes.data ?? []).length);
      setClosed(closeRes.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the day.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const sumFor = (mode: string) =>
      orders
        .filter((order) => order.payment_mode === mode)
        .reduce((sum, order) => sum + order.total_paise, 0);

    return {
      count: orders.length,
      cash: sumFor("cash"),
      upi: sumFor("upi"),
      card: sumFor("card"),
      total: orders.reduce((sum, order) => sum + order.total_paise, 0),
    };
  }, [orders]);

  async function closeDay() {
    setClosing(true);
    setCloseError(null);
    try {
      await postJson("/api/day-close", { business_date: date });
      await load();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Could not close the day.");
    } finally {
      setClosing(false);
    }
  }

  if (!isAdmin) return <ErrorBanner message="Day close is owner-only." />;

  return (
    <div className="grid gap-5">
      <div>
        <SectionTitle>Day close</SectionTitle>
        <p className="mt-0.5 text-sm text-slate-500">
          Freezes the date. Bills from a closed day can no longer be edited or voided.
        </p>
      </div>

      <Card className="p-4 sm:max-w-xs">
        <Field label="Business date" htmlFor="date">
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </Card>

      {loading && <Spinner label="Loading the day…" />}
      {!loading && error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!loading && !error && (
        <>
          <Card className="p-4">
            <h3 className="text-sm font-bold text-slate-900">Takings for {date}</h3>

            <dl className="mt-3 grid gap-2 text-sm">
              <Row label="Bills settled" value={String(totals.count)} />
              <Row label="Cash — should be in the drawer" value={formatPaise(totals.cash)} strong />
              <Row label="UPI" value={formatPaise(totals.upi)} />
              <Row label="Card" value={formatPaise(totals.card)} />
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd>{formatPaise(totals.total)}</dd>
              </div>
            </dl>
          </Card>

          {closed ? (
            <Card className="border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">
                This day was closed on {formatDateTime(closed.closed_at)}.
              </p>
              <p className="mt-1 text-sm text-green-800">
                {closed.bill_count} bills · {formatPaise(closed.total_paise)} recorded.
              </p>
            </Card>
          ) : (
            <Card className="p-4">
              {openTabs > 0 && (
                <p className="mb-3 text-sm font-medium text-amber-700">
                  {openTabs} tab{openTabs === 1 ? " is" : "s are"} still open for this
                  date. Settle {openTabs === 1 ? "it" : "them"} before closing.
                </p>
              )}

              {closeError && (
                <div className="mb-3">
                  <ErrorBanner message={closeError} />
                </div>
              )}

              <Button onClick={closeDay} disabled={closing || openTabs > 0}>
                {closing ? "Closing…" : `Close ${date}`}
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={strong ? "font-bold" : "font-semibold"}>{value}</dd>
    </div>
  );
}
