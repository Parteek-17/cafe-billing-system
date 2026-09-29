import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every discount, void and day close is logged with who did it and when.
 * Writes go through the service-role client, because audit_log has no client
 * insert policy by design.
 *
 * A failed audit write must never lose the business operation that succeeded,
 * so this logs to the console and carries on rather than throwing.
 */
export async function writeAudit(
  admin: SupabaseClient,
  entry: {
    actor: string | null;
    action: string;
    entity: string;
    entity_id: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entity_id,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });

  if (error) {
    console.error("[audit] could not write audit entry", entry.action, error.message);
  }
}
