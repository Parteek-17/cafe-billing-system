"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useApp } from "@/components/app-shell";
import type { AppSettings, GstMode, Profile } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  SectionTitle,
  Select,
  Spinner,
} from "@/components/ui";

const DEFAULT_TEMPLATE =
  "Hi {{customer_name}}, thank you for visiting {{cafe_name}}! Your bill {{bill_no}} for {{total}} is here: {{bill_link}}";

/**
 * Settings — owner only. app_settings is a single row (id = 1), enforced by a
 * CHECK in the database, so this screen creates it if it does not exist yet
 * and updates it thereafter.
 */
export default function SettingsPage() {
  const { isAdmin, reloadSettings } = useApp();

  const [form, setForm] = useState({
    cafe_name: "",
    address: "",
    gstin: "",
    gst_mode: "exclusive" as GstMode,
    bill_prefix: "CAFE",
    whatsapp_template: DEFAULT_TEMPLATE,
  });

  const [exists, setExists] = useState(false);
  const [staff, setStaff] = useState<Profile[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const [settingsRes, staffRes] = await Promise.all([
        supabase.from("app_settings").select("*").eq("id", 1).maybeSingle<AppSettings>(),
        supabase.from("profiles").select("*").order("name", { ascending: true }),
      ]);

      if (settingsRes.error) throw settingsRes.error;

      if (settingsRes.data) {
        setExists(true);
        setForm({
          cafe_name: settingsRes.data.cafe_name,
          address: settingsRes.data.address ?? "",
          gstin: settingsRes.data.gstin ?? "",
          gst_mode: settingsRes.data.gst_mode,
          bill_prefix: settingsRes.data.bill_prefix,
          whatsapp_template: settingsRes.data.whatsapp_template,
        });
      }

      setStaff((staffRes.data ?? []) as Profile[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    if (!form.cafe_name.trim()) {
      setSaveError("The café needs a name — it goes on every bill.");
      return;
    }
    if (!form.bill_prefix.trim()) {
      setSaveError("Set a bill-number prefix, e.g. CAFE.");
      return;
    }
    if (!form.whatsapp_template.trim()) {
      setSaveError("The WhatsApp message cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const payload = {
        id: 1,
        cafe_name: form.cafe_name.trim(),
        address: form.address.trim() || null,
        gstin: form.gstin.trim() || null,
        gst_mode: form.gst_mode,
        bill_prefix: form.bill_prefix.trim(),
        whatsapp_template: form.whatsapp_template.trim(),
      };

      const { error: writeError } = exists
        ? await supabase.from("app_settings").update(payload).eq("id", 1)
        : await supabase.from("app_settings").insert(payload);

      if (writeError) throw writeError;

      setExists(true);
      setSaved(true);
      await reloadSettings();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) return <ErrorBanner message="Settings is owner-only." />;
  if (loading) return <Spinner label="Loading settings…" />;

  return (
    <div className="grid gap-5">
      <div>
        <SectionTitle>Settings</SectionTitle>
        <p className="mt-0.5 text-sm text-slate-500">
          These appear on every bill and drive the GST calculation.
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!exists && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          There is no <code className="font-mono">app_settings</code> row yet. Billing is
          blocked until you save this form once.
        </Card>
      )}

      <Card className="p-4">
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Café name" htmlFor="cafe_name">
            <Input
              id="cafe_name"
              value={form.cafe_name}
              onChange={(e) => setForm({ ...form, cafe_name: e.target.value })}
              placeholder="Sizzle & Sip"
            />
          </Field>

          <Field label="GSTIN" htmlFor="gstin">
            <Input
              id="gstin"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              placeholder="03ABCDE1234F1Z5"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Address" htmlFor="address">
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Model Town, Ludhiana"
              />
            </Field>
          </div>

          <Field
            label="GST mode"
            htmlFor="gst_mode"
            hint="Inclusive means menu prices already contain GST."
          >
            <Select
              id="gst_mode"
              value={form.gst_mode}
              onChange={(e) => setForm({ ...form, gst_mode: e.target.value as GstMode })}
            >
              <option value="exclusive">Exclusive — GST added on top</option>
              <option value="inclusive">Inclusive — GST already in the price</option>
            </Select>
          </Field>

          <Field
            label="Bill number prefix"
            htmlFor="bill_prefix"
            hint="Bills look like PREFIX/2026-09-29/007."
          >
            <Input
              id="bill_prefix"
              value={form.bill_prefix}
              onChange={(e) => setForm({ ...form, bill_prefix: e.target.value })}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="WhatsApp thanks note"
              htmlFor="whatsapp_template"
              hint="Placeholders: {{customer_name}} {{cafe_name}} {{bill_no}} {{total}} {{bill_link}}"
            >
              <textarea
                id="whatsapp_template"
                value={form.whatsapp_template}
                onChange={(e) => setForm({ ...form, whatsapp_template: e.target.value })}
                rows={4}
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            {saveError && (
              <p role="alert" className="mb-2 text-sm font-medium text-red-600">
                {saveError}
              </p>
            )}
            {saved && (
              <p className="mb-2 text-sm font-medium text-green-700">Settings saved.</p>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </Card>

      {/* --------------------------------------------------------- staff */}
      <Card className="p-4">
        <h3 className="text-sm font-bold text-slate-900">Staff accounts</h3>
        <p className="mt-1 text-sm text-slate-500">
          Accounts are created in Supabase → Authentication → Users, then given a matching
          row in <code className="font-mono">public.profiles</code> with the right role.
        </p>

        <ul className="mt-3 grid gap-1.5 text-sm">
          {staff.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3">
              <span className="truncate">{person.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={person.role === "admin" ? "green" : "slate"}>
                  {person.role}
                </Badge>
                {!person.is_active && <Badge tone="red">Inactive</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
