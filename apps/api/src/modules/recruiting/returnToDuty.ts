import type { SupabaseClient } from "@supabase/supabase-js";
import { returnToDutyOutstanding } from "@silvicom/shared";

/**
 * §40.25(j) — the read behind the gate (0237).
 *
 * ── WHY TWO READS AND NOT ONE COLUMN ──────────────────────────────────────────────────────────
 * The obligation is a flag on `drivers`, projected from the certified application by trigger. The
 * DISCHARGE is a `return_to_duty` qualification record — §40.305 documentation, filed with its scan
 * like everything else in the §391.51 file. Storing "discharged" a second time as a boolean would be
 * the same fact in two places, and the two places would disagree the first time somebody deleted a
 * record or filed one through a path that forgot to flip the flag.
 *
 * The second read is only ever issued for a driver who actually owes something, which is a small
 * minority of a roster, so the cost is paid by the case that has a reason to pay it.
 *
 * ⚠ **Both queries org-filter themselves.** The API reads with the service role, which bypasses RLS,
 * and a gate that could be satisfied by another tenant's record would be worse than no gate.
 */
export async function returnToDutyBlocked(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<boolean> {
  const { data: driver } = await admin
    .from("drivers")
    .select("return_to_duty_required")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  const required = Boolean((driver as { return_to_duty_required?: boolean } | null)?.return_to_duty_required);
  if (!required) return false;

  const { data: records } = await admin
    .from("qualification_records")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "return_to_duty")
    .limit(1);

  return returnToDutyOutstanding({
    returnToDutyRequired: true,
    returnToDutyDocumented: (records ?? []).length > 0,
  });
}
