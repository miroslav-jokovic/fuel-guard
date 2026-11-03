import type { ApplyPhases } from "@/features/apply/useApplication";

/**
 * Where an application stands, in four stages the applicant can read (HIRING-WORKFLOW-AUDIT §13 D-SP1).
 *
 * Derived from the phases the link already serves, never stored: the permissions (`releasesCompletedAt`),
 * the application filled in and handed over (`reviewRequestedAt`, or the approval that follows it), the
 * company's review (`approvedAt`), and the office visit — road test, orientation, signing — which ends
 * with the filing (`submittedAt`). The first stage not done is the current one; the rest are later.
 */
export const APPLICANT_STAGES = ["permissions", "application", "review", "visit"] as const;
export type ApplicantStage = (typeof APPLICANT_STAGES)[number];
export type StageState = "done" | "current" | "later";

export function applicantStages(p: ApplyPhases): Array<{ stage: ApplicantStage; state: StageState }> {
  const done: Record<ApplicantStage, boolean> = {
    permissions: Boolean(p.releasesCompletedAt),
    application: Boolean(p.reviewRequestedAt || p.approvedAt || p.submittedAt),
    review: Boolean(p.approvedAt || p.submittedAt),
    visit: Boolean(p.submittedAt),
  };
  const current = APPLICANT_STAGES.find((s) => !done[s]);
  return APPLICANT_STAGES.map((stage) => ({
    stage,
    state: done[stage] ? "done" : stage === current ? "current" : "later",
  }));
}
