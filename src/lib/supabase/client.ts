"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Uses the anon key and is therefore subject to Row Level
 * Security — this is what the architecture means by "harmless reads go
 * straight from the browser to the database".
 *
 * Every read in this app goes through here. Writes that must not be trusted
 * to the browser go to /api/* instead.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.",
    );
  }

  return createBrowserClient(url, key);
}
