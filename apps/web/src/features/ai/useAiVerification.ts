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

export interface AiTriageInfo {
  risk_level: string;
  risk_score: number;
  recommended_action: string;
}

/** Latest AI assessment per transaction, as a map — powers the AI triage column + ranking. */
export function useAiAssessments() {
  return useQuery({
    queryKey: ["ai_assessments_map"],
    queryFn: async (): Promise<Record<string, AiTriageInfo>> => {
      const { data, error } = await supabase
        .from("ai_verifications")
        .select("transaction_id, risk_level, risk_score, recommended_action, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      const map: Record<string, AiTriageInfo> = {};
      for (const r of (data ?? []) as { transaction_id: string; risk_level: string; risk_score: number; recommended_action: string }[]) {
        if (!map[r.transaction_id]) {
          map[r.transaction_id] = { risk_level: r.risk_level, risk_score: r.risk_score, recommended_action: r.recommended_action };
        }
      }
      return map;
    },
  });
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
