import { paiseToPlain } from "@/lib/money";
import { toWhatsAppNumber } from "@/lib/phone";
import type { AppSettings, Order } from "@/lib/types";

/**
 * All WhatsApp logic lives here, so the transport can change without touching
 * the rest of the app.
 *
 * Today that transport is the one-tap wa.me link: staff press the button, the
 * customer's chat opens with the message already typed, and they hit send.
 * No API account, no per-message cost, no 24-hour session window and no
 * template approval — all of which apply to the Business/Cloud API and none
 * of which a café counter needs.
 */

/** Fills the owner's saved thanks-note template. */
export function renderMessage(
  order: Order,
  settings: AppSettings,
  billLink: string,
): string {
  return settings.whatsapp_template
    .replaceAll("{{customer_name}}", order.customer_name ?? "there")
    .replaceAll("{{cafe_name}}", settings.cafe_name)
    .replaceAll("{{bill_no}}", order.bill_no ?? "")
    .replaceAll("{{total}}", `Rs. ${paiseToPlain(order.total_paise)}`)
    .replaceAll("{{bill_link}}", billLink)
    .trim();
}

/** https://wa.me/91<phone>?text=<thanks note + bill link> */
export function buildWaMeUrl(
  order: Order,
  settings: AppSettings,
  billLink: string,
): string {
  const message = renderMessage(order, settings, billLink);
  const number = toWhatsAppNumber(order.customer_phone ?? "");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
