import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantIdentity } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * The office's correction of an applicant's date of birth and licence (AF3, D-AF8).
 *
 * It OVERWRITES `drivers` and the applicant's draft together, through the one SQL writer — so the
 * page's own driver read and the checklist are both stale afterwards and are refetched. `driver-detail`
 * is `ApplicantRecordPage`'s key for the row this drawer is showing the identity from.
 */
export function useCorrectApplicantIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitationId: string; driverId: string; identity: ApplicantIdentity }) => {
      const res = await apiFetch<{ ok: true }>(
        `/api/recruitment/applications/${encodeURIComponent(input.invitationId)}/identity`,
        { method: "POST", body: input.identity },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Could not correct the licence.");
    },
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["driver-detail"] });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
    },
  });
}
