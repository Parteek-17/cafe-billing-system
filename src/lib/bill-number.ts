import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Allocates the next bill number for a business date.
 *
 * bill_counters holds one row per date. We claim a number with a
 * compare-and-swap: bump last_no only if it is still the value we read. If
 * another staff member won the race the update matches zero rows and we read
 * again, so two simultaneous settles can never receive the same number.
 *
 * This needs no database function and no changes to the existing schema.
 *
 * Caveat, stated plainly: a number is claimed just before the order row is
 * written. If the process dies in that gap the number is burnt and the
 * sequence shows a gap. Numbers are always unique; they are gapless only in
 * normal operation. For strict gaplessness under crashes, move this into a
 * Postgres function so the claim and the bill write share one transaction —
 * see the README.
 */
export async function allocateBillNo(
  admin: SupabaseClient,
  businessDate: string,
  prefix: string,
): Promise<{ seq: number; billNo: string }> {
  const MAX_ATTEMPTS = 12;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: counter, error: readError } = await admin
      .from("bill_counters")
      .select("last_no")
      .eq("business_date", businessDate)
      .maybeSingle<{ last_no: number }>();

    if (readError) throw new Error(`Could not read bill counter: ${readError.message}`);

    // First bill of the day — create the counter row, then loop round and
    // claim from it. A concurrent insert just makes this a no-op.
    if (!counter) {
      const { error: insertError } = await admin
        .from("bill_counters")
        .insert({ business_date: businessDate, last_no: 0 });

      if (insertError && insertError.code !== "23505") {
        throw new Error(`Could not start the bill counter: ${insertError.message}`);
      }
      continue;
    }

    const next = counter.last_no + 1;

    const { data: claimed, error: claimError } = await admin
      .from("bill_counters")
      .update({ last_no: next })
      .eq("business_date", businessDate)
      .eq("last_no", counter.last_no) // compare-and-swap
      .select("last_no");

    if (claimError) throw new Error(`Could not claim a bill number: ${claimError.message}`);

    if (claimed && claimed.length === 1) {
      return {
        seq: next,
        billNo: `${prefix}/${businessDate}/${String(next).padStart(3, "0")}`,
      };
    }
    // Lost the race — read again and retry.
  }

  throw new Error(
    "Could not allocate a bill number after several attempts. Try settling again.",
  );
}
