import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { SmsConsentStatus } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Whether a text reaches one applicant, and the office's one act on it (SMS-OPT-IN-PLAN SMS4).
 *
 * ⚠ There is no grant here, by design: a consent is the applicant's own act on their own link
 * (D-SMS1, D-SMS3). The office can see it and can record a stop the applicant asked for some other
 * way — a call, an email — because 47 CFR §64.1200(a)(10) says any reasonable means counts (D-SMS6).
 */
export const applicantSmsConsentKey = (driverId: string) => ["recruitment", "sms-consent", driverId] as const;

export function useApplicantSmsConsentQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => applicantSmsConsentKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<SmsConsentStatus> => {
      const res = await apiFetch<{ status: SmsConsentStatus }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/sms-consent`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load text-message consent.");
      return res.data.status;
    },
  });
}

export function useRecordSmsStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driverId: string): Promise<SmsConsentStatus> => {
      const res = await apiFetch<{ status: SmsConsentStatus }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId)}/sms-consent/withdraw`,
        { method: "POST", body: {} },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the stop.");
      return res.data.status;
    },
    onSuccess: (status, driverId) => qc.setQueryData(applicantSmsConsentKey(driverId), status),
  });
}
