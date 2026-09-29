"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { formatPaise } from "@/lib/money";
import { formatTime, toDateInput } from "@/lib/business-date";
import { useApp } from "@/components/app-shell";
import type { Order } from "@/lib/types";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  SectionTitle,
  Spinner,
} from "@/components/ui";

/**
 * Bill history. Row Level Security does the filtering: the owner sees every
 * bill, a staff member only the ones they opened or settled.
 */
export default function BillsPage() {
  const { isAdmin } = useApp();
  const today = toDateInput(new Date());

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");

  const [bills, setBills] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("orders")
        .select("*")
        .neq("status", "open")
        .gte("business_date", from)
        .lte("business_date", to)
        .order("business_date", { ascending: false })
        .order("settled_at", { ascending: false });

      if (queryError) throw queryError;
      setBills((data ?? []) as Order[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the bills.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const query = search.trim().toLowerCase();
  const visible = query
    ? bills.filter((bill) =>
        [bill.bill_no, bill.customer_name, bill.customer_phone]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(query)),
      )
    : bills;

  return (
    <div className="grid gap-5">
      <div>
        <SectionTitle>Bills</SectionTitle>
        <p className="mt-0.5 text-sm text-slate-500">
          {isAdmin ? "Every bill in the café." : "The bills you handled."}
        </p>
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <Field label="From" htmlFor="from">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Search" htmlFor="search" hint="Bill number, name or phone.">
          <Input
            id="search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="CAFE/…"
          />
        </Field>
      </Card>

      {loading && <Spinner label="Loading bills…" />}

      {!loading && error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!loading && !error && visible.length === 0 && (
        <EmptyState>No bills in this range.</EmptyState>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="grid gap-2">
          {visible.map((bill) => (
            <li key={bill.id}>
              <Link
                href={`/bills/${bill.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    <span className="truncate">{bill.bill_no}</span>
                    {bill.status === "void" && <Badge tone="red">Void</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {bill.customer_name || bill.customer_phone || "—"} ·{" "}
                    {bill.business_date}
                    {bill.settled_at ? ` · ${formatTime(bill.settled_at)}` : ""}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-semibold text-slate-900">
                    {formatPaise(bill.total_paise)}
                  </p>
                  <p className="text-xs uppercase text-slate-400">{bill.payment_mode}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
