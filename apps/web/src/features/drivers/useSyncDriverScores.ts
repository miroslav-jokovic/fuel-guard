import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

export interface DriverScoreSyncResult {
  weekStart: string;
  drivers: number;
  upserted: number;
  safetyOk: boolean;
  efficiencyOk: boolean;
}

/** Pull the current week's Samsara Safety + Efficiency component scores (admin / fleet manager). */
export function useSyncDriverScores() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<DriverScoreSyncResult> => {
      const res = await apiFetch<DriverScoreSyncResult>("/api/integrations/samsara/sync-driver-scores", {
        method: "POST",
      });
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not sync driver scores from Samsara");
      }
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver_performance_current"] }),
  });
}
