/**
 * Row types mirroring the existing Supabase schema exactly.
 * Source of truth: cafe_billing_schema.sql — do not add columns here that do
 * not exist in the database.
 */

export type Role = "admin" | "staff";
export type MenuStatus = "draft" | "active";
export type OrderStatus = "open" | "settled" | "void";
export type PaymentMode = "cash" | "upi" | "card";
export type DiscountType = "flat" | "percent";
export type GstMode = "inclusive" | "exclusive";

export interface Profile {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  price_paise: number;
  tax_rate: number;
  status: MenuStatus;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  local_uuid: string;
  bill_no: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: OrderStatus;
  subtotal_paise: number;
  discount_type: DiscountType | null;
  discount_value: number | null;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  payment_mode: PaymentMode | null;
  opened_by: string;
  settled_by: string | null;
  opened_at: string;
  settled_at: string | null;
  business_date: string;
  pdf_path: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  unit_price_paise: number;
  tax_rate: number;
  qty: number;
  line_total_paise: number;
  created_at: string;
  updated_at: string;
}

export interface BillCounter {
  business_date: string;
  last_no: number;
  updated_at: string;
}

export interface DayClose {
  business_date: string;
  closed_by: string;
  closed_at: string;
  bill_count: number;
  cash_paise: number;
  upi_paise: number;
  card_paise: number;
  total_paise: number;
}

export interface AppSettings {
  id: number;
  cafe_name: string;
  address: string | null;
  gstin: string | null;
  logo_path: string | null;
  gst_mode: GstMode;
  bill_prefix: string;
  whatsapp_template: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  at: string;
}

/** An open tab with its lines, as the billing screen needs it. */
export interface OrderWithItems extends Order {
  order_items: OrderItem[];
}
