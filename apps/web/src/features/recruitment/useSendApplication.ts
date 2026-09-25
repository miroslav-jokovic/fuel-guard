import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { HiringStepKey, SmsHoldReason } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";
import { applicantSmsConsentKey } from "@/features/recruitment/useApplicantSmsConsent";
import { inviteKey, type ApplicationInviteDelivery } from "@/features/recruitment/useApplicationInvites";

/** What the office's Send answers with (AF4). The link is the only copy there will ever be. */
export interface ApplicationSent {
  link: string;
  /** Screening steps not done when it was sent (D-AF5) — keys; the words come from the catalogue. */
  warnings: HiringStepKey[];
  applicationSentAt: string;
  delivery: ApplicationInviteDelivery;
  /**
   * D-SMS7: whether the link also went by text. `no_consent` is the ordinary answer and reads as "not
   * agreed", never as a failure. Optional: an API from before SMS4 does not send it.
   */
  text?: { sent: boolean; reason: SmsHoldReason | "send_failed" | null };
}

/**
 * Send the applicant the application form (AF4, D-AF5, D-AF7).
 *
 * The checklist and the invitation list are both stale afterwards — a step turned green and the
 * invitation's state moved — so both are refetched.
 */
export function useSendApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitationId: string; driverId: string }): Promise<ApplicationSent> => {
      const res = await apiFetch<ApplicationSent>(
        `/api/recruitment/applications/${encodeURIComponent(input.invitationId)}/send-application`,
        { method: "POST", body: {} },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not send the application.");
      return res.data;
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
      void qc.invalidateQueries({ queryKey: inviteKey(input.driverId) });
      // A send is also the moment a stale "texts on" would mislead: an opt-out may have arrived by
      // STOP since the drawer opened.
      void qc.invalidateQueries({ queryKey: applicantSmsConsentKey(input.driverId) });
    },
  });
}
