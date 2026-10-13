import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  USER_ROLES,
  canReadTestingRecords,
  formatDisplayDate,
  isMedstopDerAlert,
  isMedstopViolation,
  medstopFilesHiringDrugTest,
  medstopResultNotice,
  medstopTestOutcome,
  shiftDay,
  type MedstopTestOutcome,
} from "@silvicom/shared";
import { insertQualificationRecord } from "../evidence/index.js";
import { notify } from "../messaging/index.js";
import { usersInRoles } from "../org/index.js";

/**
 * What a new Med-Stop result DOES (MEDSTOP-PLAN.md §6 F-4/F-5, MS2b). Runs after every sweep, on the
 * tests the sweep found with a result nobody has acted on yet (`outcome_handled` null — a new test,
 * or one whose result an MRO corrected, 0464).
 *
 * - A verified NEGATIVE pre-employment drug test on a certainly-matched person files the hiring
 *   step's `drug_test` record, Med-Stop's test id as `reference` — the step ticks without anyone
 *   typing. Once per test, by the code here AND by 0466's index.
 * - A POSITIVE, a REFUSAL, a NEGATIVE-DILUTE or a wording nobody classified is sent to every admin
 *   and safety_manager — the roles `canReadTestingRecords` admits, derived, not listed.
 * - A violation does NOT write a block anywhere. The dispatch door reads it (`medstopViolationOn`),
 *   so the block lasts exactly as long as the facts do: until a return-to-duty record dated on or
 *   after it is filed. This file only tells the DER that it happened.
 *
 * Never on `baseline` tests (D-MS5). A pre-employment negative whose person is not matched yet — an
 * applicant whose licence reaches our row a day after the result — waits for the match for
 * `MATCH_WAIT_DAYS` before it is let go as handled-without-filing.
 */
const CERTAIN_MATCH = new Set(["licence", "name_dob"]);
const MATCH_WAIT_DAYS = 30;
const TESTING_RECORD_ROLES = USER_ROLES.filter((r) => canReadTestingRecords(r));

interface PendingTest {
  medstop_id: string;
  employee_medstop_id: string | null;
  service: string | null;
  reason: string | null;
  status: string | null;
  result: string | null;
  collected_local: string | null;
}

interface Person {
  driverId: string | null;
  certain: boolean;
  name: string | null;
}

export interface MedstopOutcomeResult {
  filed: number;
  alerted: number;
  handled: number;
}

async function unhandledTests(admin: SupabaseClient, orgId: string): Promise<PendingTest[]> {
  const out: PendingTest[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("medstop_tests")
      .select("medstop_id, employee_medstop_id, service, reason, status, result, collected_local")
      .eq("org_id", orgId)
      .eq("baseline", false)
      .is("outcome_handled", null)
      .not("result", "is", null)
      .order("medstop_id")
      .range(from, from + 999);
    if (error) throw new Error(`medstop_tests read failed: ${error.message}`);
    out.push(...((data ?? []) as PendingTest[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Med-Stop person → our driver (certain or not) and the name the DER will read. */
async function peopleFor(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  if (ids.length === 0) return out;
  const { data, error } = await admin
    .from("medstop_employees")
    .select("medstop_id, driver_id, match_rule, first_name, last_name")
    .eq("org_id", orgId)
    .in("medstop_id", ids);
  if (error) throw new Error(`medstop_employees read failed: ${error.message}`);
  const rows = (data ?? []) as { medstop_id: string; driver_id: string | null; match_rule: string | null; first_name: string | null; last_name: string | null }[];
  const driverIds = [...new Set(rows.map((r) => r.driver_id).filter((d): d is string => d !== null))];
  const names = new Map<string, string>();
  if (driverIds.length > 0) {
    const { data: drivers, error: dErr } = await admin.from("drivers").select("id, full_name").eq("org_id", orgId).in("id", driverIds);
    if (dErr) throw new Error(`drivers read failed: ${dErr.message}`);
    for (const d of (drivers ?? []) as { id: string; full_name: string | null }[]) if (d.full_name) names.set(d.id, d.full_name);
  }
  for (const r of rows) {
    const medstopName = [r.first_name, r.last_name].filter(Boolean).join(" ") || null;
    out.set(r.medstop_id, {
      driverId: r.driver_id,
      certain: r.driver_id !== null && CERTAIN_MATCH.has(r.match_rule ?? ""),
      name: (r.driver_id && names.get(r.driver_id)) || medstopName,
    });
  }
  return out;
}

async function fileNegative(admin: SupabaseClient, orgId: string, t: PendingTest, driverId: string, today: string): Promise<boolean> {
  const inserted = await insertQualificationRecord(admin, orgId, null, {
    id: randomUUID(),
    driverId,
    kind: "drug_test",
    occurredOn: t.collected_local?.slice(0, 10) ?? today,
    coversUntil: null,
    result: "negative",
    performedBy: "Med-Stop",
    reference: t.medstop_id,
    documentId: null,
    detail: { source: "medstop", medstop_test_id: t.medstop_id, reason: t.reason, collected_local: t.collected_local },
  });
  // "duplicate" is 0466 saying it is already on file — a retried sweep, not a failure.
  return !("code" in inserted) || inserted.code === "duplicate";
}

async function markHandled(admin: SupabaseClient, orgId: string, testId: string, outcome: MedstopTestOutcome): Promise<void> {
  const { error } = await admin
    .from("medstop_tests")
    .update({ outcome_handled: outcome, outcome_handled_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("medstop_id", testId);
  if (error) throw new Error(`medstop_tests update failed: ${error.message}`);
}

export async function actOnMedstopResults(admin: SupabaseClient, orgId: string, today: string): Promise<MedstopOutcomeResult> {
  const result: MedstopOutcomeResult = { filed: 0, alerted: 0, handled: 0 };
  const tests = await unhandledTests(admin, orgId);
  if (tests.length === 0) return result;
  const people = await peopleFor(admin, orgId, [...new Set(tests.map((t) => t.employee_medstop_id).filter((e): e is string => e !== null))]);
  let recipients: string[] | null = null;

  for (const t of tests) {
    const outcome = medstopTestOutcome(t);
    // A drug result before review is not a result (`medstopTestOutcome`); the next sweep looks again.
    if (outcome === "pending") continue;
    const person = (t.employee_medstop_id && people.get(t.employee_medstop_id)) || null;

    if (medstopFilesHiringDrugTest(t, outcome)) {
      if (person?.certain && person.driverId) {
        if (!(await fileNegative(admin, orgId, t, person.driverId, today))) continue;
        result.filed++;
      } else if ((t.collected_local?.slice(0, 10) ?? today) > shiftDay(today, -MATCH_WAIT_DAYS)) {
        continue;
      }
    }

    if (isMedstopDerAlert(outcome)) {
      recipients ??= await usersInRoles(admin, orgId, TESTING_RECORD_ROLES);
      if (recipients.length === 0) console.warn(`[medstop] org ${orgId}: a result needs the DER and nobody may read testing records`);
      const notice = medstopResultNotice({
        outcome,
        service: t.service,
        reason: t.reason,
        collectedOn: t.collected_local ? formatDisplayDate(t.collected_local.slice(0, 10)) : null,
        personName: person?.name ?? null,
        dispatchStopped: isMedstopViolation(outcome) && Boolean(person?.certain),
      });
      for (const userId of recipients) {
        await notify(admin, {
          orgId,
          userId,
          category: "drug_alcohol_result",
          ...notice,
          entityType: "medstop_test",
          entityId: t.medstop_id,
          // Per outcome, so an MRO correction from dilute to positive is news; a retry is not.
          dedupeKey: `medstop-result:${t.medstop_id}:${outcome}`,
        });
      }
      result.alerted++;
    }

    await markHandled(admin, orgId, t.medstop_id, outcome);
    result.handled++;
  }
  return result;
}
