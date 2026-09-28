import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantPurgeResult } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * "Delete permanently" (Q-AW40, P2). The refusal is thrown as `apiRefusal` so the drawer's
 * `holdForStepUp` can tell the password prompt from 0380's refusals. Invalidates the pipeline and the
 * roster the way archiving does: an applicant is a `drivers` row, and it is gone from both.
 */
export function useApplicantPurge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { driverId: string; confirmName: string }): Promise<ApplicantPurgeResult> => {
      const res = await apiFetch<ApplicantPurgeResult>(`/api/recruitment/applicants/${payload.driverId}/purge`, {
        method: "POST",
        body: { confirm_name: payload.confirmName },
      });
      if (!res.ok || !res.data) throw apiRefusal(res.error, "Could not delete the applicant.");
      return res.data;
    },
    onSuccess: (_r, payload) => {
      void qc.invalidateQueries({ queryKey: ["recruitment", "pipeline"] });
      void qc.invalidateQueries({ queryKey: ["drivers"] });
      void qc.invalidateQueries({ queryKey: ["roster", "driver", payload.driverId] });
    },
  });
}
