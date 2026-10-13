import type { SupabaseClient } from "@supabase/supabase-js";
import { isMedstopViolation, medstopTestOutcome } from "@silvicom/shared";

/**
 * "Does Med-Stop hold a violation for this driver, and from which day?" — the half of the dispatch
 * door that MS2 adds (MEDSTOP-PLAN.md §6 F-5; `returnToDutyCause` in shared rules on the answer).
 *
 * ── ONLY A CERTAIN MATCH STOPS A DRIVER ───────────────────────────────────────────────────────
 * Med-Stop's person reaches our driver through `medstop_employees.driver_id`, matched by licence +
 * state, then name + DOB, then — weakest — a unique name (`matchMedstopPerson`). A name alone is not
 * enough to take somebody off the road: two drivers called the same thing, one of them on our roster
 * and one not, is exactly the collision a name match cannot see. So a violation on a name-only match
 * alerts the DER (who confirms who it is) and stops nobody; licence and name+DOB stop.
 *
 * ── HISTORY DOES NOT STOP ANYBODY (D-MS5) ─────────────────────────────────────────────────────
 * `baseline` tests are what the first sweep found already old — handled, or not, before the product
 * watched. They are listed for review and never read here.
 *
 * ⚠ THROWS on a read error. A dispatch door that cannot tell whether a driver has a positive must not
 * answer "no" — the caller's request fails, and the dispatcher tries again, which is recoverable;
 * a positive driver dispatched because a read hiccupped is not.
 */
const CERTAIN_MATCH = ["licence", "name_dob"];

export async function medstopViolationOn(admin: SupabaseClient, orgId: string, driverId: string): Promise<string | null> {
  const { data: people, error: peopleError } = await admin
    .from("medstop_employees")
    .select("medstop_id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .in("match_rule", CERTAIN_MATCH);
  if (peopleError) throw new Error(`medstop_employees read failed: ${peopleError.message}`);
  const ids = ((people ?? []) as { medstop_id: string }[]).map((p) => p.medstop_id);
  if (ids.length === 0) return null;

  const { data: tests, error } = await admin
    .from("medstop_tests")
    .select("service, status, result, collected_local")
    .eq("org_id", orgId)
    .in("employee_medstop_id", ids)
    .eq("baseline", false)
    .not("result", "is", null);
  if (error) throw new Error(`medstop_tests read failed: ${error.message}`);

  let newest: string | null = null;
  for (const t of (tests ?? []) as { service: string | null; status: string | null; result: string | null; collected_local: string | null }[]) {
    if (!isMedstopViolation(medstopTestOutcome(t))) continue;
    // A violation with no collection stamp still counts — from the earliest day there is, so that
    // only a return-to-duty record can discharge it, never the absence of a date.
    const day = t.collected_local?.slice(0, 10) ?? "0001-01-01";
    if (newest === null || day > newest) newest = day;
  }
  return newest;
}
