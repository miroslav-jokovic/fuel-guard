import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { CarrierQuestion, CarrierQuestionCreate, CarrierQuestionUpdate } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The carrier's own application questions (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3 CQ2, 0567) — Settings →
 * Recruiting's list. What an applicant is asked is the invitation's stamp (D-CQ2), so a change here moves
 * no applicant already sent the form; nothing else needs refetching.
 */
export const carrierQuestionsKey = ["recruitment", "carrier-questions"] as const;

export function useCarrierQuestions() {
  return useQuery({
    queryKey: carrierQuestionsKey,
    queryFn: async (): Promise<CarrierQuestion[]> => {
      const res = await apiFetch<{ questions: CarrierQuestion[] }>("/api/recruitment/carrier-questions");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load your questions.");
      return res.data.questions;
    },
  });
}

export function useAddCarrierQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CarrierQuestionCreate): Promise<CarrierQuestion> => {
      const res = await apiFetch<{ question: CarrierQuestion }>("/api/recruitment/carrier-questions", { method: "POST", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the question.");
      return res.data.question;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: carrierQuestionsKey }),
  });
}

export function useUpdateCarrierQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; patch: CarrierQuestionUpdate }): Promise<CarrierQuestion> => {
      const res = await apiFetch<{ question: CarrierQuestion }>(`/api/recruitment/carrier-questions/${v.id}`, { method: "PATCH", body: v.patch });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not change the question.");
      return res.data.question;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: carrierQuestionsKey }),
  });
}
