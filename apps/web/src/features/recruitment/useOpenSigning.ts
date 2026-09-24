import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { HiringStepKey } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";
import { inviteKey } from "@/features/recruitment/useApplicationInvites";

/** What the office's Open signing answers with (AF5). The sign link is the only copy there will be. */
export interface SigningOpened {
  link: string;
  /** Federal gates and the road test not done when it was opened (D-AF6) — keys, words from the catalogue. */
  warnings: HiringStepKey[];
  signingOpenedAt: string;
}

/**
 * Open packet signing, in the office (AF5, D-AF3, D-AF6).
 *
 * The checklist and the invitation list are both stale afterwards — the packet row moved from the
 * office's move to the applicant's, and the invitation's state moved — so both are refetched.
 */
export function useOpenSigning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitationId: string; driverId: string }): Promise<SigningOpened> => {
      const res = await apiFetch<SigningOpened>(
        `/api/recruitment/applications/${encodeURIComponent(input.invitationId)}/open-signing`,
        { method: "POST", body: {} },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not open signing.");
      return res.data;
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
      void qc.invalidateQueries({ queryKey: inviteKey(input.driverId) });
    },
  });
}
