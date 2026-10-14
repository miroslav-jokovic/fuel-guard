import type { SupabaseClient } from "@supabase/supabase-js";
import { isMedstopViolation, medstopRefusalDay, medstopTestOutcome, type MedstopRequestFacts } from "@silvicom/shared";
import { readAll } from "./program.js";

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
    .select("employee_medstop_id, service, status, result, collected_local")
    .eq("org_id", orgId)
    .in("employee_medstop_id", ids)
    .eq("baseline", false)
    .not("result", "is", null);
  if (error) throw new Error(`medstop_tests read failed: ${error.message}`);
  // A request Med-Stop closed as REFUSAL has no test row (§7A.16) — the refusal lives on the request.
  const { data: requests, error: rError } = await admin
    .from("medstop_requests")
    .select(REQUEST_COLUMNS)
    .eq("org_id", orgId)
    .in("employee_medstop_id", ids)
    .ilike("status", "%refus%");
  if (rError) throw new Error(`medstop_requests read failed: ${rError.message}`);
  return newestViolation((tests ?? []) as TestRow[], (requests ?? []) as unknown as RequestRow[]);
}

/**
 * The same answer for a whole org at once — driver id → newest violation day, drivers with none
 * absent. For the fleet overview and the binder (MEDSTOP-PLAN §7A.15), which must agree with the
 * dispatch door driver by driver, so both read through `newestViolation`.
 *
 * Two org-wide reads joined here rather than an `.in()` of every Med-Stop id: a fleet's worth of ids
 * overflows the request line (Node 22's header limit), and both reads are small.
 */
export async function medstopViolationsByDriver(admin: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const [people, tests, requests] = await Promise.all([
    readAll<{ medstop_id: string; driver_id: string | null; match_rule: string | null }>((a, b) => admin.from("medstop_employees")
      .select("medstop_id, driver_id, match_rule")
      .eq("org_id", orgId).in("match_rule", CERTAIN_MATCH).not("driver_id", "is", null).order("medstop_id").range(a, b), "medstop_employees"),
    readAll<TestRow>((a, b) => admin.from("medstop_tests")
      .select("employee_medstop_id, service, status, result, collected_local")
      .eq("org_id", orgId).eq("baseline", false).not("result", "is", null).order("medstop_id").range(a, b), "medstop_tests"),
    readAll<RequestRow>((a, b) => admin.from("medstop_requests")
      .select(REQUEST_COLUMNS)
      .eq("org_id", orgId).ilike("status", "%refus%").order("medstop_id").range(a, b), "medstop_requests"),
  ]);
  // The query's filter, held again: only a certain match stops anybody (above).
  const driverOf = new Map(people.filter((p) => p.driver_id && CERTAIN_MATCH.includes(p.match_rule ?? "")).map((p) => [p.medstop_id, p.driver_id as string]));
  const byDriver = new Map<string, { tests: TestRow[]; requests: RequestRow[] }>();
  const of = (employee: string | null) => {
    const driver = employee ? driverOf.get(employee) : undefined;
    if (!driver) return null;
    if (!byDriver.has(driver)) byDriver.set(driver, { tests: [], requests: [] });
    return byDriver.get(driver)!;
  };
  for (const t of tests) of(t.employee_medstop_id)?.tests.push(t);
  for (const r of requests) of(r.employee_medstop_id)?.requests.push(r);
  const out = new Map<string, string>();
  for (const [driver, rows] of byDriver) {
    const day = newestViolation(rows.tests, rows.requests);
    if (day) out.set(driver, day);
  }
  return out;
}

type TestRow = { employee_medstop_id: string | null; service: string | null; status: string | null; result: string | null; collected_local: string | null };
type RequestRow = MedstopRequestFacts & { employee_medstop_id: string | null };
const REQUEST_COLUMNS = "employee_medstop_id, status, requested_local, tested_local, first_seen_at";

/** The newest violation day over a person's tests (a positive or refused result) and requests (a REFUSAL close). */
function newestViolation(tests: readonly TestRow[], requests: readonly RequestRow[]): string | null {
  let newest: string | null = null;
  for (const t of tests) {
    if (!isMedstopViolation(medstopTestOutcome(t))) continue;
    // A violation with no collection stamp still counts — from the earliest day there is, so that
    // only a return-to-duty record can discharge it, never the absence of a date.
    const day = t.collected_local?.slice(0, 10) ?? "0001-01-01";
    if (newest === null || day > newest) newest = day;
  }
  // The query narrowed by wording; the verdict (and D-MS5's history rule) is the shared function's.
  for (const r of requests) {
    const day = medstopRefusalDay(r);
    if (day !== null && (newest === null || day > newest)) newest = day;
  }
  return newest;
}
