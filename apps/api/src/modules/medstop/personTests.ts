import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canReadTestingRecords,
  medstopOrderOpen,
  medstopResultExpectedOn,
  medstopStageLabel,
  medstopTestKind,
  medstopTestOutcome,
  type MedstopPersonTests,
  type UserRole,
} from "@silvicom/shared";
import { getCredential } from "./credentials.js";

/**
 * What Med-Stop holds for ONE person — the hiring drawer's drug-test step (MEDSTOP-PLAN.md §6 F-4,
 * MS2c). Orders still waiting for the donor, and tests with their stage and the day the result is
 * due.
 *
 * ── ⚠ THE RESULT IS FILTERED HERE, NOT IN THE DRAWER ──────────────────────────────────────────
 * The recruiter is this screen's main reader and may not read testing records (§382.401(a)). So the
 * outcome leaves the API as `null` for them — a browser that never receives a value cannot show it.
 * They still see that the test is "Result reported", and the step ticking (a filed negative) or not.
 *
 * ── ONLY A CERTAIN MATCH ──────────────────────────────────────────────────────────────────────
 * The person is reached through a licence or name + date-of-birth match, as the dispatch door is
 * (`violations.ts`): a name-only match could show a recruiter somebody else's test.
 */
const CERTAIN_MATCH = ["licence", "name_dob"];
const SHOWN = 5;

export async function readMedstopTestsForDriver(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  role: UserRole | null,
): Promise<MedstopPersonTests> {
  const outcomesVisible = canReadTestingRecords(role);
  const credential = await getCredential(admin, orgId);
  const connected = credential?.hasKey === true && credential.enabled;
  const empty: MedstopPersonTests = { connected, matched: false, applicantMedstopId: null, orders: [], tests: [], outcomesVisible };

  const { data: people, error: pErr } = await admin
    .from("medstop_employees")
    .select("medstop_id, roster")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .in("match_rule", CERTAIN_MATCH);
  if (pErr) throw new Error(`medstop_employees read failed: ${pErr.message}`);
  const rows = (people ?? []) as { medstop_id: string; roster: string | null }[];
  const ids = rows.map((p) => p.medstop_id);
  if (ids.length === 0) return empty;

  const [testsRes, ordersRes] = await Promise.all([
    admin
      .from("medstop_tests")
      .select("medstop_id, service, reason, status, result, collected_local")
      .eq("org_id", orgId)
      .in("employee_medstop_id", ids)
      .order("collected_local", { ascending: false, nullsFirst: true })
      .limit(SHOWN),
    admin
      .from("medstop_requests")
      .select("medstop_id, service, reason, status, requested_local, test_medstop_id")
      .eq("org_id", orgId)
      .in("employee_medstop_id", ids)
      .order("requested_local", { ascending: false })
      .limit(SHOWN),
  ]);
  if (testsRes.error) throw new Error(`medstop_tests read failed: ${testsRes.error.message}`);
  if (ordersRes.error) throw new Error(`medstop_requests read failed: ${ordersRes.error.message}`);

  type TestRow = { medstop_id: string; service: string | null; reason: string | null; status: string | null; result: string | null; collected_local: string | null };
  type OrderRow = { medstop_id: string; service: string | null; reason: string | null; status: string | null; requested_local: string | null; test_medstop_id: string | null };

  return {
    connected,
    matched: true,
    // What the step's "Order pre-employment test" is placed on (UX4). The order route checks the
    // roster, the match and our applicant again before anything is sent.
    applicantMedstopId: rows.find((p) => p.roster === "applicant")?.medstop_id ?? null,
    orders: ((ordersRes.data ?? []) as OrderRow[])
      .filter((o) => o.test_medstop_id === null && medstopOrderOpen(o.status))
      .map((o) => ({
        requestId: o.medstop_id,
        kind: medstopTestKind(o.service),
        reason: o.reason,
        requestedOn: o.requested_local?.slice(0, 10) ?? null,
        status: o.status,
      })),
    tests: ((testsRes.data ?? []) as TestRow[]).map((t) => {
      const outcome = medstopTestOutcome(t);
      const expected = outcome === "pending" ? medstopResultExpectedOn(t.service, t.collected_local) : null;
      return {
        testId: t.medstop_id,
        kind: medstopTestKind(t.service),
        reason: t.reason,
        stage: medstopStageLabel(t.service, t.status),
        collectedOn: t.collected_local?.slice(0, 10) ?? null,
        // A due date already behind us still shows — "expected 10/12" on 10/14 tells the recruiter to
        // call, which is the reason the date is there at all.
        expectedOn: expected,
        outcome: outcomesVisible ? outcome : null,
      };
    }),
    outcomesVisible,
  };
}
