import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDSTOP_HISTORY_DAYS, shiftDay, type CalendarDay } from "@silvicom/shared";
import {
  MedstopClient,
  medstopRequestRow,
  medstopTestRow,
  medstopTestStageRow,
  type MedstopRequestRow,
  type MedstopTestRow,
} from "./client.js";

/**
 * Med-Stop's requests and tests → the merged mirror (MEDSTOP-PLAN.md §6 F-4/F-5, MS2, 0464).
 *
 * GET only. Results are stored but never READ here — every reader of `medstop_tests.result` filters
 * by `canReadTestingRecords`, and this file has no reader.
 *
 * ── A WINDOW, NOT THE HISTORY ─────────────────────────────────────────────────────────────────
 * 1,666 tests and 2,152 requests since 2013 (2026-10-13). Reading all of it every hour is ~39 pages
 * on top of MS1's ~25, against a 100-a-minute limit. A test still moving is at most weeks old, so the
 * sweep reads the last `MEDSTOP_TEST_WINDOW_DAYS` and MERGES — a row that falls out of the window
 * keeps its last state, which by then is final.
 *
 * ── THE TRAIL ONLY WHERE SOMETHING MOVED ──────────────────────────────────────────────────────
 * `/Test/{id}/status` is one request per test. It is fetched for a test whose status differs from the
 * mirror's (a new test included), and on the org's first sweep only for tests not yet CLOSED — about
 * five on any day — capped per sweep so a backlog can never outrun the rate limit.
 *
 * ── HISTORY IS NOT NEWS ───────────────────────────────────────────────────────────────────────
 * On the org's first test sweep, a test collected more than `BASELINE_AGE_DAYS` ago is stored as
 * `baseline`: listed for review, never acted on (the column's comment in 0464 says why).
 */

export const MEDSTOP_TEST_WINDOW_DAYS = 400;
// Shared with a request's history rule (`medstopRefusalDay`), so a test and a request age alike.
const BASELINE_AGE_DAYS = MEDSTOP_HISTORY_DAYS;
const TRAIL_CAP = 40;

export interface MedstopTestSweepResult {
  requests: number;
  tests: number;
  trails: number;
  baseline: number;
}

/** Each test we already hold → its status, so the sweep can tell what moved. */
async function knownTestStatuses(admin: SupabaseClient, orgId: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  // PostgREST answers at most 1,000 rows a page; page explicitly.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("medstop_tests")
      .select("medstop_id, status")
      .eq("org_id", orgId)
      .order("medstop_id")
      .range(from, from + 999);
    if (error) throw new Error(`medstop_tests read failed: ${error.message}`);
    for (const r of (data ?? []) as { medstop_id: string; status: string | null }[]) out.set(r.medstop_id, r.status);
    if (!data || data.length < 1000) return out;
  }
}

const yesNo = (v: string | null): boolean | null => (v === null ? null : v.toUpperCase() === "Y");

function requestRecord(r: MedstopRequestRow) {
  return {
    medstop_id: r.id,
    employee_medstop_id: r.eeid,
    service: r.service,
    category: r.category,
    reason: r.reason,
    observed: yesNo(r.observed),
    dot_regulated: yesNo(r.dotstatus),
    requested_local: r.requestdate,
    payment: r.payment,
    location: r.location,
    test_medstop_id: r.testid,
    tested_local: r.testdate,
    status: r.status,
  };
}

function testRecord(t: MedstopTestRow, stages: { status: string; at: string | null }[] | null, baseline: boolean) {
  return {
    medstop_id: t.id,
    employee_medstop_id: t.eeid,
    service: t.service,
    category: t.category,
    reason: t.reason,
    dot_regulated: yesNo(t.dotstatus),
    collected_local: t.collectiondate,
    result: t.result,
    location: t.location,
    status: t.status,
    stages,
    baseline,
  };
}

async function merge(admin: SupabaseClient, orgId: string, kind: "requests" | "tests", rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.rpc("medstop_merge", { p_org: orgId, p_kind: kind, p_rows: rows });
  if (error) throw new Error(`medstop_merge(${kind}) failed: ${error.message}`);
}

export async function sweepMedstopTests(
  admin: SupabaseClient,
  client: MedstopClient,
  orgId: string,
  today: CalendarDay,
): Promise<MedstopTestSweepResult> {
  // 1. Fetch both lists before writing either, as MS1's sweep does: a half-read is not written.
  const since = shiftDay(today, -MEDSTOP_TEST_WINDOW_DAYS);
  const requests = await client.list(`/Request/list?requestedafter=${since}`, medstopRequestRow);
  const tests = await client.list(`/Test/list?testafter=${since}`, medstopTestRow);

  const known = await knownTestStatuses(admin, orgId);
  const firstSweep = known.size === 0;
  const historyBefore = shiftDay(today, -BASELINE_AGE_DAYS);

  // 2. The trail, only where the status moved — capped, oldest first so a backlog drains in order.
  const moved = tests
    .filter((t) => (firstSweep ? t.status !== "CLOSED" : !known.has(t.id) || known.get(t.id) !== t.status))
    .sort((a, b) => (a.collectiondate ?? "").localeCompare(b.collectiondate ?? ""))
    .slice(0, TRAIL_CAP);
  const trails = new Map<string, { status: string; at: string | null }[]>();
  for (const t of moved) {
    const steps = await client.list(`/Test/${encodeURIComponent(t.id)}/status`, medstopTestStageRow, 50);
    // Med-Stop answers newest first; the mirror keeps the order things happened in.
    trails.set(t.id, steps.map((s) => ({ status: s.status, at: s.created })).reverse());
  }

  // 3. Write.
  let baseline = 0;
  const testRows = tests.map((t) => {
    const isHistory = firstSweep && t.collectiondate !== null && t.collectiondate.slice(0, 10) < historyBefore;
    if (isHistory) baseline++;
    return testRecord(t, trails.get(t.id) ?? null, isHistory);
  });
  await merge(admin, orgId, "requests", requests.map(requestRecord));
  await merge(admin, orgId, "tests", testRows);
  return { requests: requests.length, tests: tests.length, trails: trails.size, baseline };
}
