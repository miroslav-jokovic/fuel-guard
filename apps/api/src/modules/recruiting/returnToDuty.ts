import type { SupabaseClient } from "@supabase/supabase-js";
import { returnToDutyCause } from "@silvicom/shared";
import { medstopViolationOn } from "../medstop/index.js";

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
 * ⚠ **Every query org-filters itself** (Med-Stop's included, `medstopViolationOn`). The API reads with the service role, which bypasses RLS,
 * and a gate that could be satisfied by another tenant's record would be worse than no gate.
 */
export async function returnToDutyHold(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<"violation" | "admission" | null> {
  return (await returnToDutyStanding(admin, orgId, driverId)).cause;
}

/**
 * The hold AND the Med-Stop violation day behind it — the driver page's read (MEDSTOP-PLAN §7A.15),
 * which `dispatchHoldForReader` redacts per reader. One function under both, so the page and the
 * dispatch door cannot disagree about whether this driver is held.
 */
export async function returnToDutyStanding(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<{ cause: "violation" | "admission" | null; violationOn: string | null }> {
  // MS2 (MEDSTOP-PLAN.md F-5): the second obligation, a Med-Stop positive or refusal, read where it
  // lives. Not a second flag on `drivers`: the fact is Med-Stop's result, and a copy of it would
  // outlive an MRO correction that the read sees the next hour.
  const [{ data: driver }, violationOn] = await Promise.all([
    admin
      .from("drivers")
      .select("return_to_duty_required")
      .eq("org_id", orgId)
      .eq("id", driverId)
      .maybeSingle(),
    medstopViolationOn(admin, orgId, driverId),
  ]);
  const required = Boolean((driver as { return_to_duty_required?: boolean } | null)?.return_to_duty_required);
  if (!required && violationOn === null) return { cause: null, violationOn: null };

  // The NEWEST record, because a violation is discharged only by one dated on or after it.
  const { data: records } = await admin
    .from("qualification_records")
    .select("occurred_on")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "return_to_duty")
    .order("occurred_on", { ascending: false })
    .limit(1);
  const filed = (records ?? []) as { occurred_on?: string | null }[];

  const cause = returnToDutyCause({
    returnToDutyRequired: required,
    returnToDutyDocumented: filed.length > 0,
    violationOn,
    lastReturnToDutyOn: filed[0]?.occurred_on ?? null,
  });
  return { cause, violationOn };
}

/** May this driver NOT be put behind the wheel? The dispatch door's question (`returnToDutyHold`). */
export async function returnToDutyBlocked(admin: SupabaseClient, orgId: string, driverId: string): Promise<boolean> {
  return (await returnToDutyHold(admin, orgId, driverId)) !== null;
}
