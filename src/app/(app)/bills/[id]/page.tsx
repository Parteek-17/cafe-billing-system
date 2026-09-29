"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { getJson, postJson } from "@/lib/api";
import { formatPaise } from "@/lib/money";
import { formatDateTime } from "@/lib/business-date";
import { formatPhone } from "@/lib/phone";
import { useApp } from "@/components/app-shell";
import type { Order, OrderItem } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Spinner,
} from "@/components/ui";

/**
 * The finished bill: on screen, as a PDF, on WhatsApp, or printed.
 * The owner can also void it (reason required).
 */
export default function BillPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const billId = params.id;
  const { settings, isAdmin } = useApp();

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "pdf" | "whatsapp" | "void">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const [orderRes, itemsRes] = await Promise.all([
        supabase.from("orders").select("*").eq("id", billId).maybeSingle<Order>(),
        supabase
          .from("order_items")
          .select("*")
          .eq("order_id", billId)
          .order("created_at", { ascending: true }),
      ]);

      if (orderRes.error) throw orderRes.error;
      if (!orderRes.data) throw new Error("This bill does not exist, or you cannot see it.");

      setOrder(orderRes.data);
      setItems((itemsRes.data ?? []) as OrderItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the bill.");
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generatePdf() {
    setBusy("pdf");
    setActionError(null);
    try {
      const { url } = await postJson<{ url: string }>(`/api/bills/${billId}/pdf`);
      setPdfUrl(url);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not make the PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function sendWhatsApp() {
    setBusy("whatsapp");
    setActionError(null);
    try {
      // Make sure a PDF exists first, so the message carries a real link.
      if (!order?.pdf_path && !pdfUrl) {
        await postJson(`/api/bills/${billId}/pdf`);
      }
      const { url } = await getJson<{ url: string }>(`/api/bills/${billId}/whatsapp-link`);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not build the WhatsApp message.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmVoid(event: React.FormEvent) {
    event.preventDefault();
    setBusy("void");
    setActionError(null);
    try {
      const { order: voided } = await postJson<{ order: Order }>(
        `/api/bills/${billId}/void`,
        { reason: voidReason },
      );
      setOrder(voided);
      setVoiding(false);
      setVoidReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not void the bill.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Loading bill…" />;

  if (error || !order) {
    return (
      <div className="grid gap-4">
        <ErrorBanner message={error ?? "Bill not found."} onRetry={() => void load()} />
        <Button variant="secondary" onClick={() => router.push("/bills")}>
          Back to bills
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => router.push("/bills")}>
          Back
        </Button>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="secondary" onClick={generatePdf} disabled={busy !== null}>
            {busy === "pdf" ? "Making PDF…" : "Open PDF"}
          </Button>
          <Button onClick={sendWhatsApp} disabled={busy !== null || !order.customer_phone}>
            {busy === "whatsapp" ? "Preparing…" : "Send on WhatsApp"}
          </Button>
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      {!order.customer_phone && (
        <p className="no-print text-sm text-slate-500">
          This bill has no phone number, so it cannot be sent on WhatsApp.
        </p>
      )}

      {/* ------------------------------------------------------- receipt */}
      <Card className="print-sheet mx-auto w-full max-w-md p-6">
        <header className="text-center">
          <h1 className="text-lg font-bold">{settings?.cafe_name ?? "Café"}</h1>
          {settings?.address && (
            <p className="mt-0.5 text-xs text-slate-500">{settings.address}</p>
          )}
          {settings?.gstin && (
            <p className="text-xs text-slate-500">GSTIN: {settings.gstin}</p>
          )}
        </header>

        <div className="my-4 border-t border-dashed border-slate-300" />

        <div className="flex items-start justify-between gap-2 text-sm">
          <div>
            <p className="font-semibold">{order.bill_no}</p>
            <p className="text-xs text-slate-500">
              {order.customer_name || "—"}
              {order.customer_phone ? ` · ${formatPhone(order.customer_phone)}` : ""}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{order.settled_at ? formatDateTime(order.settled_at) : ""}</p>
            {order.status === "void" && <Badge tone="red">Void</Badge>}
          </div>
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
              <th className="pb-1 font-semibold">Item</th>
              <th className="pb-1 text-right font-semibold">Qty</th>
              <th className="pb-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((line) => (
              <tr key={line.id} className="border-b border-slate-100">
                <td className="py-1.5">{line.name_snapshot}</td>
                <td className="py-1.5 text-right">{line.qty}</td>
                <td className="py-1.5 text-right">{formatPaise(line.line_total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Subtotal</dt>
            <dd>{formatPaise(order.subtotal_paise)}</dd>
          </div>
          {order.discount_paise > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-500">
                Discount
                {order.discount_type === "percent" ? ` (${order.discount_value}%)` : ""}
              </dt>
              <dd>− {formatPaise(order.discount_paise)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate-500">
              GST{settings?.gst_mode === "inclusive" ? " (included)" : ""}
            </dt>
            <dd>{formatPaise(order.tax_paise)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-300 pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatPaise(order.total_paise)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs uppercase text-slate-500">
          Paid by {order.payment_mode}
        </p>

        <p className="mt-6 text-center text-xs text-slate-500">
          Thank you for visiting{settings ? ` ${settings.cafe_name}` : ""}.
        </p>
      </Card>

      {/* ---------------------------------------------------------- void */}
      {isAdmin && order.status === "settled" && (
        <Card className="no-print p-4">
          {!voiding ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Made a mistake? A bill is never deleted — voiding keeps the record honest.
              </p>
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Void this bill
              </Button>
            </div>
          ) : (
            <form onSubmit={confirmVoid} className="grid gap-3" noValidate>
              <Field label="Reason for voiding" htmlFor="void-reason">
                <Input
                  id="void-reason"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Duplicate bill, customer cancelled"
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" disabled={busy !== null}>
                  {busy === "void" ? "Voiding…" : "Confirm void"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setVoiding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
