"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/lib/api";
import { formatPaise } from "@/lib/money";
import { formatTime } from "@/lib/business-date";
import { formatPhone } from "@/lib/phone";
import type { Order, OrderItem } from "@/lib/types";
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

type OpenTab = Order & { order_items: Pick<OrderItem, "id" | "qty">[] };

/**
 * Billing home — every open tab, and the one button that starts a new one.
 * Tapping a tab opens it for editing and settling.
 */
export default function BillingPage() {
  const router = useRouter();

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      // Row Level Security decides what comes back: the owner sees every open
      // tab, a staff member only their own.
      const { data, error: queryError } = await supabase
        .from("orders")
        .select("*, order_items(id, qty)")
        .eq("status", "open")
        .order("opened_at", { ascending: true });

      if (queryError) throw queryError;
      setTabs((data ?? []) as OpenTab[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the open tabs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTab(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim() && !phone.trim()) {
      setFormError("Enter a customer name or a phone number.");
      return;
    }

    setCreating(true);
    try {
      const { order } = await postJson<{ order: Order }>("/api/tabs", {
        customer_name: name,
        customer_phone: phone,
      });
      router.push(`/billing/${order.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not open the tab.");
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <SectionTitle>New tab</SectionTitle>
        <Card className="p-4">
          <form
            onSubmit={createTab}
            className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]"
            noValidate
          >
            <Field label="Customer name" htmlFor="tab-name">
              <Input
                id="tab-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Simran"
                autoComplete="off"
              />
            </Field>

            <Field label="Phone" htmlFor="tab-phone" hint="Needed to send the bill on WhatsApp.">
              <Input
                id="tab-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                autoComplete="off"
              />
            </Field>

            {/* An empty label on wide screens, so the button sits on the same
                line as the two inputs rather than under them. */}
            <div className="grid content-start gap-1.5">
              <span aria-hidden="true" className="hidden text-sm font-semibold sm:block">
                &nbsp;
              </span>
              <Button type="submit" disabled={creating} block>
                {creating ? "Opening…" : "Open tab"}
              </Button>
            </div>
          </form>

          {formError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {formError}
            </p>
          )}
        </Card>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Open tabs</SectionTitle>
          <Button variant="ghost" onClick={() => void load()} className="!min-h-[36px]">
            Refresh
          </Button>
        </div>

        {loading && <Spinner label="Loading open tabs…" />}

        {!loading && error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {!loading && !error && tabs.length === 0 && (
          <EmptyState>No open tabs. Start one above when a customer orders.</EmptyState>
        )}

        {!loading && !error && tabs.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {tabs.map((tab) => {
              const itemCount = tab.order_items.reduce((sum, line) => sum + line.qty, 0);

              return (
                <li key={tab.id}>
                  <Link
                    href={`/billing/${tab.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {tab.customer_name || formatPhone(tab.customer_phone)}
                        </p>
                        {tab.customer_name && tab.customer_phone && (
                          <p className="truncate text-xs text-slate-500">
                            {formatPhone(tab.customer_phone)}
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 font-semibold text-slate-900">
                        {formatPaise(tab.subtotal_paise)}
                      </p>
                    </div>

                    <p className="mt-2 text-xs text-slate-500">
                      {itemCount} item{itemCount === 1 ? "" : "s"} · open since{" "}
                      {formatTime(tab.opened_at)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
