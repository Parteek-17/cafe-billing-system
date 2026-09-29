"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { useApp } from "@/components/app-shell";
import type { Category, MenuItem } from "@/lib/types";
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
} from "@/components/ui";

/**
 * Menu management — owner only.
 *
 * These writes go straight from the browser to the database. That is safe
 * because the menu policies only accept an admin; a staff token is refused by
 * Postgres itself, not by this screen.
 *
 * A Draft item does not appear on the billing grid until it is published.
 */
export default function MenuPage() {
  const { isAdmin } = useApp();

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemTax, setItemTax] = useState("5");
  const [itemError, setItemError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const [catRes, itemRes] = await Promise.all([
        supabase.from("categories").select("*").order("sort_order", { ascending: true }),
        supabase
          .from("menu_items")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
      ]);

      if (catRes.error) throw catRes.error;
      if (itemRes.error) throw itemRes.error;

      setCategories((catRes.data ?? []) as Category[]);
      setItems((itemRes.data ?? []) as MenuItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    setCategoryError(null);

    const name = categoryName.trim();
    if (!name) {
      setCategoryError("Give the category a name.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from("categories")
        .insert({ name, sort_order: categories.length });

      if (insertError) throw insertError;
      setCategoryName("");
      await load();
    } catch (err) {
      setCategoryError(
        err instanceof Error ? err.message : "Could not add the category.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    setItemError(null);

    const name = itemName.trim();
    if (!name) return setItemError("Give the item a name.");
    if (!itemCategory) return setItemError("Choose a category.");

    const pricePaise = rupeesToPaise(itemPrice);
    if (pricePaise === null) return setItemError("Enter a price like 120 or 120.50.");

    const taxRate = Number(itemTax);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return setItemError("GST must be between 0 and 100.");
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("menu_items").insert({
        category_id: itemCategory,
        name,
        price_paise: pricePaise,
        tax_rate: taxRate,
        status: "draft", // published explicitly, so it cannot be billed by accident
        is_available: true,
        sort_order: items.filter((i) => i.category_id === itemCategory).length,
      });

      if (insertError) throw insertError;
      setItemName("");
      setItemPrice("");
      await load();
    } catch (err) {
      setItemError(err instanceof Error ? err.message : "Could not add the item.");
    } finally {
      setBusy(false);
    }
  }

  async function patchItem(id: string, patch: Partial<MenuItem>) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("menu_items")
        .update(patch)
        .eq("id", id);

      if (updateError) throw updateError;
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the item.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return <ErrorBanner message="The menu is owner-only." />;
  }

  if (loading) return <Spinner label="Loading menu…" />;

  return (
    <div className="grid gap-6">
      <div>
        <SectionTitle>Menu</SectionTitle>
        <p className="mt-0.5 text-sm text-slate-500">
          Draft items stay off the billing grid until you publish them.
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* ----------------------------------------------------- category */}
      <Card className="p-4">
        <h3 className="text-sm font-bold text-slate-900">Add a category</h3>
        <form onSubmit={addCategory} className="mt-3 flex flex-wrap items-end gap-3" noValidate>
          <div className="min-w-[12rem] flex-1">
            <Field label="Name" htmlFor="category-name">
              <Input
                id="category-name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Hot drinks"
              />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            Add category
          </Button>
        </form>
        {categoryError && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            {categoryError}
          </p>
        )}
      </Card>

      {/* --------------------------------------------------------- item */}
      <Card className="p-4">
        <h3 className="text-sm font-bold text-slate-900">Add an item</h3>
        <form onSubmit={addItem} className="mt-3 grid gap-3 sm:grid-cols-2" noValidate>
          <Field label="Name" htmlFor="item-name">
            <Input
              id="item-name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Masala chai"
            />
          </Field>

          <Field label="Category" htmlFor="item-category">
            <Select
              id="item-category"
              value={itemCategory}
              onChange={(e) => setItemCategory(e.target.value)}
            >
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Price (₹)" htmlFor="item-price">
            <Input
              id="item-price"
              inputMode="decimal"
              value={itemPrice}
              onChange={(e) => setItemPrice(e.target.value)}
              placeholder="120.00"
            />
          </Field>

          <Field label="GST %" htmlFor="item-tax">
            <Input
              id="item-tax"
              inputMode="decimal"
              value={itemTax}
              onChange={(e) => setItemTax(e.target.value)}
              placeholder="5"
            />
          </Field>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || categories.length === 0}>
              Add item as draft
            </Button>
            {categories.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">Add a category first.</p>
            )}
          </div>
        </form>
        {itemError && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            {itemError}
          </p>
        )}
      </Card>

      {/* -------------------------------------------------------- lists */}
      {categories.length === 0 && <EmptyState>No categories yet.</EmptyState>}

      {categories.map((category) => {
        const categoryItems = items.filter((item) => item.category_id === category.id);

        return (
          <section key={category.id} className="grid gap-2">
            <h3 className="text-sm font-bold text-slate-900">{category.name}</h3>

            {categoryItems.length === 0 ? (
              <EmptyState>No items in this category yet.</EmptyState>
            ) : (
              <Card className="divide-y divide-slate-100">
                {categoryItems.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="truncate">{item.name}</span>
                        {item.status === "draft" ? (
                          <Badge tone="amber">Draft</Badge>
                        ) : (
                          <Badge tone="green">Active</Badge>
                        )}
                        {!item.is_available && <Badge tone="slate">Out of stock</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatPaise(item.price_paise)} · GST {item.tax_rate}%
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        className="!min-h-[36px]"
                        disabled={busy}
                        onClick={() =>
                          patchItem(item.id, {
                            status: item.status === "active" ? "draft" : "active",
                          })
                        }
                      >
                        {item.status === "active" ? "Unpublish" : "Publish"}
                      </Button>

                      <Button
                        variant="secondary"
                        className="!min-h-[36px]"
                        disabled={busy}
                        onClick={() =>
                          patchItem(item.id, { is_available: !item.is_available })
                        }
                      >
                        {item.is_available ? "Mark out of stock" : "Back in stock"}
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </section>
        );
      })}
    </div>
  );
}
