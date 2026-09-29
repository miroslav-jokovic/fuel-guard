import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { SigningSent } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";
import { inviteKey } from "@/features/recruitment/useApplicationInvites";

/**
 * Send the packet for signing, to the applicant's phone (D-AW14, C3s3a).
 *
 * The answer says where the link went and never carries it (`SigningSent`). The checklist and the
 * invitation list are both stale afterwards — the packet row moved to the applicant's move, and the
 * invitation now has a sign link with an end — so both are refetched.
 */
export function useSendForSigning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitationId: string; driverId: string }): Promise<SigningSent> => {
      const res = await apiFetch<SigningSent>(
        `/api/recruitment/applications/${encodeURIComponent(input.invitationId)}/send-for-signing`,
        { method: "POST", body: {} },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not send it for signing.");
      return res.data;
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
      void qc.invalidateQueries({ queryKey: inviteKey(input.driverId) });
    },
  });
}
