import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { HiringChecklist } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * One applicant's hiring checklist, from the fold the API serves (B5; the endpoint is B3).
 *
 * ── THE WHOLE ANSWER COMES FROM THE SERVER, INCLUDING THE WORDS ───────────────────────────────
 * ⚠ Nothing in this app decides what a step means, what blocks it, who owes the next move or what
 * proves it. `hiringChecklist.ts` in `packages/shared` folds it once and `/checklist` serves that
 * fold whole, so the office's screen and the applicant's own screen (D-HM2) cannot disagree — which
 * is the defect §1 of `HIRING-MODULE-PLAN.md` records shipping twice. A `Record<HiringStepKey, …>`
 * anywhere in `apps/web` would be that disagreement with a delay fuse.
 *
 * ⚠ Gated on `recruitment: "view"` and not `manage`, which is the endpoint's own ruling: the reader
 * a §391.51 file exists for is an auditor, and gating the summary harder than the acts it summarises
 * would hide the board from the people whose queue it is.
 */
export const applicantChecklistKey = (driverId: string) =>
  ["recruitment", "checklist", driverId] as const;

export function useApplicantChecklistQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => applicantChecklistKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<HiringChecklist> => {
      const res = await apiFetch<{ checklist: HiringChecklist }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/checklist`,
      );
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not load the hiring checklist.");
      }
      return res.data.checklist;
    },
  });
}
