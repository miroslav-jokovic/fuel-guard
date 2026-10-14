import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMedstopDerAlert,
  isMedstopViolation,
  medstopRefusalDay,
  medstopRequestRefused,
  medstopTestKind,
  medstopTestOutcome,
  type MedstopResultRow,
  type ProgramPerson,
} from "@silvicom/shared";

/**
 * Safety › Drug & Alcohol's results to review (MEDSTOP-PLAN.md §6 F-5, MS2c). Called ONLY for a
 * reader `canReadTestingRecords` admits — the caller decides, and returns null to everybody else.
 *
 * `recent` is what the DER was notified of (`isMedstopDerAlert`, not history), newest first.
 * `history` is D-MS5's other half: the positives and refusals the first sweep found already old.
 * Nothing acted on them, on purpose; this is where a person looks at each one and decides — most
 * often that the driver is gone, sometimes that a return-to-duty record belongs in the file.
 *
 * Results are read as Med-Stop's tests with a result, a year back from `today`; at ~450 tests a
 * year that is one page, and the verdict is the shared classifier's, never a string compare here.
 *
 * Plus the ORDERS Med-Stop closed as a refusal (§7A.16): the donor refused before a specimen existed,
 * so no test row carries it, yet the DER was told and dispatch is stopped — a list of "results to
 * review" without it would be missing the one row the notification sent them here for. The split is
 * the alert's own: `medstopRefusalDay` non-null is what was alerted (recent), null is D-MS5's history.
 */
export const RESULT_REVIEW_DAYS = 366;

export async function readResultReview(
  admin: SupabaseClient,
  orgId: string,
  since: string,
  personOf: (medstopId: string | null) => ProgramPerson,
): Promise<{ recent: MedstopResultRow[]; history: MedstopResultRow[] }> {
  const { data, error } = await admin
    .from("medstop_tests")
    .select("medstop_id, employee_medstop_id, service, reason, status, result, collected_local, baseline")
    .eq("org_id", orgId)
    .not("result", "is", null)
    .gte("collected_local", since)
    .order("collected_local", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`medstop_tests read failed: ${error.message}`);

  const recent: MedstopResultRow[] = [];
  const history: MedstopResultRow[] = [];
  for (const t of (data ?? []) as {
    medstop_id: string; employee_medstop_id: string | null; service: string | null; reason: string | null;
    status: string | null; result: string | null; collected_local: string | null; baseline: boolean;
  }[]) {
    const outcome = medstopTestOutcome(t);
    const row: MedstopResultRow = {
      source: "test",
      medstopId: t.medstop_id,
      person: personOf(t.employee_medstop_id),
      kind: medstopTestKind(t.service),
      reason: t.reason,
      collectedOn: t.collected_local?.slice(0, 10) ?? null,
      outcome,
    };
    if (t.baseline) {
      if (isMedstopViolation(outcome)) history.push(row);
    } else if (isMedstopDerAlert(outcome)) {
      recent.push(row);
    }
  }
  for (const { row, alerted } of await refusedOrders(admin, orgId, since, personOf)) (alerted ? recent : history).push(row);
  const newestFirst = (a: MedstopResultRow, b: MedstopResultRow) => (b.collectedOn ?? "").localeCompare(a.collectedOn ?? "");
  return { recent: recent.sort(newestFirst), history: history.sort(newestFirst) };
}

async function refusedOrders(
  admin: SupabaseClient,
  orgId: string,
  since: string,
  personOf: (medstopId: string | null) => ProgramPerson,
): Promise<{ row: MedstopResultRow; alerted: boolean }[]> {
  const { data, error } = await admin
    .from("medstop_requests")
    .select("medstop_id, employee_medstop_id, service, reason, status, requested_local, tested_local, first_seen_at")
    .eq("org_id", orgId)
    .ilike("status", "%refus%")
    .limit(1000);
  if (error) throw new Error(`medstop_requests read failed: ${error.message}`);
  const out: { row: MedstopResultRow; alerted: boolean }[] = [];
  for (const r of (data ?? []) as {
    medstop_id: string; employee_medstop_id: string | null; service: string | null; reason: string | null;
    status: string | null; requested_local: string | null; tested_local: string | null; first_seen_at: string | null;
  }[]) {
    // The query narrowed by wording; whether it IS a refusal is the shared function's.
    if (!medstopRequestRefused(r.status)) continue;
    const on = (r.tested_local ?? r.requested_local)?.slice(0, 10) ?? null;
    // The tests' year, on the visit's day. An undated refusal is shown, not dropped: it stops dispatch.
    if (on !== null && on < since) continue;
    out.push({
      row: { source: "order", medstopId: r.medstop_id, person: personOf(r.employee_medstop_id), kind: medstopTestKind(r.service), reason: r.reason, collectedOn: on, outcome: "refusal" },
      alerted: medstopRefusalDay(r) !== null,
    });
  }
  return out;
}
