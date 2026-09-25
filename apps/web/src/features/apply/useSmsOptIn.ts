import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantSmsConsent, SmsConfirmation, SmsConsentStatus } from "@silvicom/shared";
import { publicFetch } from "@/features/apply/useApplication";

/**
 * The applicant's optional agreement to be texted (SMS-OPT-IN-PLAN SMS2, D-SMS1).
 *
 * Its own query rather than a field on the link's payload, and deliberately: this card sits on the
 * waiting screens only, and the link's payload is read on every screen of the application. Nothing
 * else on the page waits on it — a failed read shows no card rather than an error, because the card
 * is an offer and its absence costs the applicant nothing they were owed.
 */
const smsKey = (token: string) => ["apply", token, "sms-consent"] as const;

export function useSmsOptIn(token: Ref<string>) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: computed(() => smsKey(token.value)),
    enabled: computed(() => Boolean(token.value)),
    retry: false,
    queryFn: () => publicFetch<ApplicantSmsConsent>(`/${token.value}/sms-consent`),
  });

  /** Write the server's answer straight back: the card shows what the server now holds, no refetch. */
  const settle = (status: SmsConsentStatus): void => {
    qc.setQueryData<ApplicantSmsConsent>(smsKey(token.value), (prev) => (prev ? { ...prev, status } : prev));
  };

  const agree = useMutation({
    // The act and the number, never the words — the server composes what was agreed to.
    mutationFn: (phone: string) =>
      publicFetch<{ status: SmsConsentStatus; confirmation: SmsConfirmation }>(`/${token.value}/sms-consent`, {
        method: "POST",
        body: JSON.stringify({ phone, agreed: true }),
      }),
    onSuccess: (res) => settle(res.status),
  });

  const withdraw = useMutation({
    mutationFn: () =>
      publicFetch<{ status: SmsConsentStatus }>(`/${token.value}/sms-consent/withdraw`, { method: "POST" }),
    onSuccess: (res) => settle(res.status),
  });

  return { query, agree, withdraw };
}
