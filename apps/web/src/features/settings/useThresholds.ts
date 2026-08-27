import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AnomalyThresholds, ThresholdsForm } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

const COLS =
  "org_id, mpg_drop_pct, capacity_tolerance_pct, rapid_refuel_hours, max_plausible_mph, cost_min_per_gal, cost_max_per_gal, disabled_rules, ai_verification_enabled, ai_monthly_token_budget";

export function useThresholdsQuery() {
  return useQuery({
    queryKey: ["thresholds"],
    queryFn: async (): Promise<AnomalyThresholds | null> => {
      const { data, error } = await supabase.from("anomaly_thresholds").select(COLS).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as AnomalyThresholds | null) ?? null;
    },
  });
}

export function useSaveThresholds() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (form: ThresholdsForm): Promise<void> => {
      if (!session.orgId) throw new Error("No organization in session");
      // P6.1: the write goes through the owner (validated, admin-gated, audited); reads stay
      // on PostgREST under the client select policy.
      const r = await apiFetch("/api/anomalies/thresholds", { method: "POST", body: form });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save thresholds");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["thresholds"] }),
  });
}
