import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { PerformanceSettingsForm } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

const COLS =
  "weight_safety, weight_efficiency, weight_idling, normalization_method, min_cohort_for_percentile, min_distance_mi, min_drive_hours, reward_top_n, trailing_weeks, settle_hours, efficiency_enabled, week_starts_on";

export type PerformanceSettings = PerformanceSettingsForm;

/** The org's driver-performance settings (null → not yet configured; the UI shows defaults). */
export function useDriverPerformanceSettings() {
  return useQuery({
    queryKey: ["driver_performance_settings"],
    queryFn: async (): Promise<PerformanceSettings | null> => {
      const { data, error } = await supabase
        .from("driver_performance_settings")
        .select(COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as PerformanceSettings | null) ?? null;
    },
    refetchInterval: 120_000,
  });
}

/** Save the org's driver-performance settings (admin only, enforced by RLS). */
export function useSaveDriverPerformanceSettings() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (form: PerformanceSettingsForm): Promise<void> => {
      if (!session.orgId) throw new Error("No active organization.");
      const { error } = await supabase
        .from("driver_performance_settings")
        .upsert({ org_id: session.orgId, ...form, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver_performance_settings"] });
      qc.invalidateQueries({ queryKey: ["driver_performance_current"] });
    },
  });
}
