"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AppSettings, Profile } from "@/lib/types";
import { Button, ErrorBanner, Spinner, cx } from "@/components/ui";

/* --------------------------------------------------------------- context */

interface AppState {
  profile: Profile;
  settings: AppSettings | null;
  isAdmin: boolean;
  reloadSettings: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppShell.");
  return value;
}

/* ------------------------------------------------------------------- nav */

const LINKS: Array<{ href: string; label: string; adminOnly: boolean }> = [
  { href: "/billing", label: "Billing", adminOnly: false },
  { href: "/bills", label: "Bills", adminOnly: false },
  { href: "/menu", label: "Menu", adminOnly: true },
  { href: "/analytics", label: "Analytics", adminOnly: true },
  { href: "/day-close", label: "Day close", adminOnly: true },
  { href: "/settings", label: "Settings", adminOnly: true },
];

function Nav({ profile, cafeName }: { profile: Profile; cafeName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const visible = LINKS.filter((link) => !link.adminOnly || profile.role === "admin");

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        <span className="shrink-0 text-sm font-bold text-slate-900">{cafeName}</span>

        <nav
          aria-label="Sections"
          className="flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visible.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium",
                  active ? "bg-brand-tint text-brand" : "text-slate-600 hover:text-slate-900",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-xs font-semibold text-slate-700">{profile.name}</p>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {profile.role}
          </p>
        </div>

        <Button variant="ghost" onClick={signOut} className="shrink-0 !min-h-[36px] !px-2">
          Sign out
        </Button>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- shell */

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("app_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle<AppSettings>();
    setSettings(data ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle<Profile>();

      if (profileError) throw profileError;

      if (!profileRow) {
        setError(
          "Your account has no row in public.profiles, so the app cannot tell whether you are the owner or staff. Add one in Supabase → Table editor → profiles, using your auth user id.",
        );
        return;
      }

      if (!profileRow.is_active) {
        setError("This account has been deactivated. Ask the owner to re-enable it.");
        return;
      }

      setProfile(profileRow);
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your account.");
    } finally {
      setLoading(false);
    }
  }, [router, loadSettings]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<AppState | null>(
    () =>
      profile
        ? {
            profile,
            settings,
            isAdmin: profile.role === "admin",
            reloadSettings: loadSettings,
          }
        : null,
    [profile, settings, loadSettings],
  );

  if (loading) {
    return (
      <div className="min-h-screen">
        <Spinner label="Loading your account…" />
      </div>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-10">
        <ErrorBanner message={error} onRetry={() => void load()} />
      </main>
    );
  }

  if (!value) return null;

  return (
    <AppContext.Provider value={value}>
      <Nav profile={value.profile} cafeName={settings?.cafe_name ?? "Café Billing"} />
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
    </AppContext.Provider>
  );
}
