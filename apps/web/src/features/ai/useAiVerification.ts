import { type Ref, toValue } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AiVerificationRecord } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

const AI_COLS =
  "id, transaction_id, anomaly_id, model, risk_score, risk_level, location_plausible, implied_speed_mph, summary, recommended_action, contributing_factors, confidence, created_at";

/** Latest AI assessment for a transaction (null until one exists). */
export function useAiVerification(transactionId: Ref<string | null>) {
  return useQuery({
    queryKey: ["ai_verifications", transactionId],
    enabled: () => !!toValue(transactionId),
    queryFn: async (): Promise<AiVerificationRecord | null> => {
      const id = toValue(transactionId);
      if (!id) return null;
      const { data, error } = await supabase
        .from("ai_verifications")
        .select(AI_COLS)
        .eq("transaction_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as AiVerificationRecord | null) ?? null;
    },
  });
}

export interface AiExamineResult {
  assessment: AiVerificationRecord | null;
  reason: string | null;
  message: string | null;
  /** True when the deterministic recon auto-cleared the anomaly (e.g. Samsara confirmed the location). */
  cleared?: boolean;
}

/** Trigger an on-demand AI re-examination of an anomaly. Returns the fresh assessment (or a reason). */
export function useAiExamine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (anomalyId: string): Promise<AiExamineResult> => {
      const res = await apiFetch<AiExamineResult>(`/api/anomalies/${anomalyId}/ai-examine`, { method: "POST" });
      if (!res.ok) throw new Error(res.error?.message ?? "AI verification failed");
      return res.data ?? { assessment: null, reason: null, message: null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai_verifications"] }),
  });
}
