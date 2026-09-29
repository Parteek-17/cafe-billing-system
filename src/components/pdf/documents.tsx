import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import { paiseToPlain } from "@/lib/money";
import { formatDateTime } from "@/lib/business-date";
import type { AppSettings, Order, OrderItem } from "@/lib/types";

/**
 * PDF documents, rendered inside our own backend — no paid PDF service.
 *
 * The built-in PDF fonts have no rupee glyph (U+20B9), so amounts are written
 * as "Rs." here rather than shipping a font file just for one character. The
 * on-screen bill uses the proper ₹ symbol.
 */

function money(paise: number): string {
  return `Rs. ${Number(paiseToPlain(paise)).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#1a1d21" },
  title: { fontSize: 16, fontWeight: "bold" },
  muted: { color: "#5b6570" },
  small: { fontSize: 9 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#d8dee4", marginVertical: 10 },
  row: { flexDirection: "row" },
  spread: { flexDirection: "row", justifyContent: "space-between" },
  mt2: { marginTop: 2 },
  mt6: { marginTop: 6 },
  mt12: { marginTop: 12 },
  bold: { fontWeight: "bold" },

  thead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1d21",
    paddingBottom: 4,
    fontWeight: "bold",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#eef1f4",
  },
  right: { textAlign: "right" },
});

/* ------------------------------------------------------------- receipt */

export interface ReceiptProps {
  order: Order;
  items: OrderItem[];
  settings: AppSettings;
  staffName: string;
}

function Receipt({ order, items, settings, staffName }: ReceiptProps) {
  return (
    <Document title={order.bill_no ?? "Bill"}>
      <Page size="A5" style={styles.page}>
        <View>
          <Text style={styles.title}>{settings.cafe_name}</Text>
          {settings.address ? (
            <Text style={[styles.small, styles.muted, styles.mt2]}>{settings.address}</Text>
          ) : null}
          {settings.gstin ? (
            <Text style={[styles.small, styles.muted]}>GSTIN: {settings.gstin}</Text>
          ) : null}
        </View>

        <View style={styles.hr} />

        <View style={styles.spread}>
          <Text style={styles.bold}>{order.bill_no}</Text>
          <Text style={styles.muted}>
            {order.settled_at ? formatDateTime(order.settled_at) : ""}
          </Text>
        </View>
        <Text style={[styles.small, styles.muted, styles.mt2]}>
          Customer: {order.customer_name || "—"}
          {order.customer_phone ? `  ·  ${order.customer_phone}` : ""}
        </Text>
        <Text style={[styles.small, styles.muted]}>Billed by: {staffName}</Text>

        <View style={styles.mt12} />

        <View style={styles.thead}>
          <Text style={{ width: "48%" }}>Item</Text>
          <Text style={{ width: "12%", textAlign: "right" }}>Qty</Text>
          <Text style={{ width: "20%", textAlign: "right" }}>Rate</Text>
          <Text style={{ width: "20%", textAlign: "right" }}>Amount</Text>
        </View>

        {items.map((item) => (
          <View key={item.id} style={styles.tr}>
            <Text style={{ width: "48%" }}>{item.name_snapshot}</Text>
            <Text style={{ width: "12%", textAlign: "right" }}>{item.qty}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>
              {money(item.unit_price_paise)}
            </Text>
            <Text style={{ width: "20%", textAlign: "right" }}>
              {money(item.line_total_paise)}
            </Text>
          </View>
        ))}

        <View style={styles.mt12} />

        <View style={styles.spread}>
          <Text style={styles.muted}>Subtotal</Text>
          <Text>{money(order.subtotal_paise)}</Text>
        </View>

        {order.discount_paise > 0 && (
          <View style={[styles.spread, styles.mt2]}>
            <Text style={styles.muted}>
              Discount
              {order.discount_type === "percent" ? ` (${order.discount_value}%)` : ""}
            </Text>
            <Text>- {money(order.discount_paise)}</Text>
          </View>
        )}

        <View style={[styles.spread, styles.mt2]}>
          <Text style={styles.muted}>
            GST {settings.gst_mode === "inclusive" ? "(included)" : ""}
          </Text>
          <Text>{money(order.tax_paise)}</Text>
        </View>

        <View style={styles.hr} />

        <View style={styles.spread}>
          <Text style={[styles.bold, { fontSize: 13 }]}>Total</Text>
          <Text style={[styles.bold, { fontSize: 13 }]}>{money(order.total_paise)}</Text>
        </View>

        <Text style={[styles.small, styles.muted, styles.mt6]}>
          Paid by {order.payment_mode?.toUpperCase()}
        </Text>

        {order.status === "void" && (
          <Text style={[styles.bold, styles.mt12, { color: "#c0392b" }]}>
            *** VOID ***
          </Text>
        )}

        <Text style={[styles.small, styles.muted, styles.mt12]}>
          Thank you for visiting {settings.cafe_name}.
        </Text>
      </Page>
    </Document>
  );
}

export function renderReceiptPdf(props: ReceiptProps): Promise<Buffer> {
  return renderToBuffer(<Receipt {...props} />);
}

/* ------------------------------------------------------------ register */

export interface RegisterProps {
  settings: AppSettings;
  from: string;
  to: string;
  orders: Order[];
  staffNames: Record<string, string>;
}

function Register({ settings, from, to, orders, staffNames }: RegisterProps) {
  const byDay = new Map<string, Order[]>();
  for (const order of orders) {
    const list = byDay.get(order.business_date) ?? [];
    list.push(order);
    byDay.set(order.business_date, list);
  }

  const days = [...byDay.keys()].sort();
  const grand = orders.reduce((sum, order) => sum + order.total_paise, 0);

  return (
    <Document title={`Register ${from} to ${to}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{settings.cafe_name} — Sales register</Text>
        <Text style={[styles.small, styles.muted, styles.mt2]}>
          {from} to {to} · {orders.length} bills
        </Text>

        <View style={styles.hr} />

        {days.map((day) => {
          const rows = byDay.get(day) ?? [];
          const dayTotal = rows.reduce((sum, row) => sum + row.total_paise, 0);

          return (
            <View key={day} wrap={false}>
              <Text style={[styles.bold, styles.mt6]}>{day}</Text>

              <View style={styles.thead}>
                <Text style={{ width: "16%" }}>Bill no.</Text>
                <Text style={{ width: "9%" }}>Time</Text>
                <Text style={{ width: "17%" }}>Customer</Text>
                <Text style={{ width: "6%", textAlign: "right" }}>Items</Text>
                <Text style={{ width: "11%", textAlign: "right" }}>Discount</Text>
                <Text style={{ width: "10%", textAlign: "right" }}>GST</Text>
                <Text style={{ width: "11%", textAlign: "right" }}>Total</Text>
                <Text style={{ width: "9%" }}>Mode</Text>
                <Text style={{ width: "11%" }}>Staff</Text>
              </View>

              {rows.map((row) => (
                <View key={row.id} style={styles.tr}>
                  <Text style={{ width: "16%" }}>{row.bill_no ?? "—"}</Text>
                  <Text style={{ width: "9%" }}>
                    {row.settled_at ? row.settled_at.slice(11, 16) : "—"}
                  </Text>
                  <Text style={{ width: "17%" }}>{row.customer_name || "—"}</Text>
                  <Text style={{ width: "6%", textAlign: "right" }}>
                    {row.status === "void" ? "VOID" : ""}
                  </Text>
                  <Text style={{ width: "11%", textAlign: "right" }}>
                    {money(row.discount_paise)}
                  </Text>
                  <Text style={{ width: "10%", textAlign: "right" }}>
                    {money(row.tax_paise)}
                  </Text>
                  <Text style={{ width: "11%", textAlign: "right" }}>
                    {money(row.total_paise)}
                  </Text>
                  <Text style={{ width: "9%" }}>{row.payment_mode ?? "—"}</Text>
                  <Text style={{ width: "11%" }}>
                    {row.settled_by ? (staffNames[row.settled_by] ?? "—") : "—"}
                  </Text>
                </View>
              ))}

              <View style={[styles.spread, styles.mt2]}>
                <Text style={[styles.small, styles.muted]}>
                  {day} total ({rows.length} bills)
                </Text>
                <Text style={styles.bold}>{money(dayTotal)}</Text>
              </View>
            </View>
          );
        })}

        <View style={styles.hr} />

        <View style={styles.spread}>
          <Text style={[styles.bold, { fontSize: 12 }]}>Grand total</Text>
          <Text style={[styles.bold, { fontSize: 12 }]}>{money(grand)}</Text>
        </View>
      </Page>
    </Document>
  );
}

export function renderRegisterPdf(props: RegisterProps): Promise<Buffer> {
  return renderToBuffer(<Register {...props} />);
}
