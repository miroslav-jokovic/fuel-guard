import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { RecallMetrics, AuditVerdict } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

export interface SampledFill {
  id: string;
  fueledAt: string;
  vehicleId: string | null;
  driverId: string | null;
  gallons: number | null;
  odometer: number | null;
  samsaraOdometer: number | null;
  computedMpg: number | null;
  pricePerGal: number | null;
  totalCost: number | null;
  locationText: string | null;
  city: string | null;
  state: string | null;
  locationConfidence: string | null;
  fuelingTimeBasis: string | null;
  observedState: string | null;
  observedCity: string | null;
}

/** A random batch of cleared, telematics-covered fills to audit for missed theft (false negatives). */
export function useAuditSample(n = 20) {
  return useQuery({
    queryKey: ["audit_sample"],
    queryFn: async (): Promise<SampledFill[]> => {
      const res = await apiFetch<{ rows: SampledFill[] }>(`/api/audit/sample?n=${n}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load a sample");
      return res.data.rows;
    },
    refetchOnWindowFocus: false,
  });
}

/** Measured recall (sampled miss rate extrapolated over the covered-clear population). */
export function useRecallMetrics() {
  return useQuery({
    queryKey: ["recall_metrics"],
    queryFn: async (): Promise<RecallMetrics> => {
      const res = await apiFetch<RecallMetrics>("/api/audit/recall-metrics");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load recall metrics");
      return res.data;
    },
  });
}

/** Record a reviewer verdict on a sampled fill, then refresh the recall metrics. */
export function useRecordVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; verdict: AuditVerdict; note?: string }): Promise<void> => {
      const { id, ...body } = payload;
      const res = await apiFetch(`/api/audit/transaction/${id}`, { method: "POST", body });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not record verdict");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recall_metrics"] }),
  });
}
