import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMedstopDerAlert,
  isMedstopViolation,
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
      testId: t.medstop_id,
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
  return { recent, history };
}
