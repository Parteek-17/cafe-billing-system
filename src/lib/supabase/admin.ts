import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES Row Level Security entirely.
 *
 * The `server-only` import above makes the build fail if this file is ever
 * pulled into a client component, so the key cannot reach the browser.
 *
 * Only used for the operations the architecture says must not be trusted to
 * the browser: settle, bill numbering, void, day close, PDF generation and
 * audit logging. Every one of those first verifies the caller with the
 * cookie-bound server client and checks their role.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the server environment.",
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
