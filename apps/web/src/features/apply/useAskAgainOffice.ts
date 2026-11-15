import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AskAgain, AskAgainView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The office asking an applicant about one answer again (APPLICATION-FIX-PLAN.md F5; migration 0607) —
 * the list, the ask and the take-back. In `features/apply` for `useApplicationReview.ts`'s reason: it
 * speaks the application's own paths.
 *
 * One query per application, shared by every row of the facts card (the same key), so forty rows are
 * one request.
 */
const key = (invitationId: string) => ["recruitment", "application-ask-again", invitationId] as const;
const base = (invitationId: string) => `/api/recruitment/applications/${encodeURIComponent(invitationId)}/ask-again`;

export function useAskAgainListQuery(invitationId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => key(invitationId.value ?? "")),
    enabled: computed(() => Boolean(invitationId.value)),
    queryFn: async (): Promise<AskAgainView[]> => {
      const res = await apiFetch<{ questions: AskAgainView[] }>(base(invitationId.value ?? ""));
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load the questions asked.");
      return res.data?.questions ?? [];
    },
  });
}

export function useAskApplicantAgain(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AskAgain): Promise<AskAgainView> => {
      const res = await apiFetch<{ question: AskAgainView }>(base(invitationId.value ?? ""), { method: "POST", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The question could not be sent.");
      return res.data.question;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
  });
}

export function useWithdrawAskAgain(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: string): Promise<AskAgainView> => {
      const res = await apiFetch<{ question: AskAgainView }>(
        `${base(invitationId.value ?? "")}/${encodeURIComponent(questionId)}/withdraw`, { method: "POST" },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The question could not be taken back.");
      return res.data.question;
    },
    // Settled: "already answered" is answered by reading the list again.
    onSettled: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
  });
}
