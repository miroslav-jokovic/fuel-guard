import { type Ref, toValue } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Anomaly, AnomalyTransition, FuelTransaction } from "@fleetguard/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

const ANOMALY_COLS =
  "id, org_id, transaction_id, vehicle_id, rule_id, severity, status, message, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, created_at, updated_at";

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface AnomalyFilters {
  status?: string;
  severity?: string;
  vehicleId?: string;
  ruleId?: string;
}

/** Anomaly queue, filtered, sorted by severity then recency (client-side sort for enum ranking). */
export function useAnomaliesQuery(filters: Ref<AnomalyFilters>) {
  return useQuery({
    queryKey: ["anomalies", filters],
    queryFn: async (): Promise<Anomaly[]> => {
      const f = toValue(filters);
      let q = supabase.from("anomalies").select(ANOMALY_COLS).limit(300);
      q = f.status ? q.eq("status", f.status) : q.neq("status", "superseded");
      if (f.severity) q = q.eq("severity", f.severity);
      if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
      if (f.ruleId) q = q.eq("rule_id", f.ruleId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as Anomaly[]).sort(
        (a, b) =>
          (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
          +new Date(b.created_at) - +new Date(a.created_at),
      );
    },
  });
}

/** The fuel transaction behind an anomaly (for the detail view). */
export function useTransaction(transactionId: Ref<string | null>) {
  return useQuery({
    queryKey: ["fuel_transaction", transactionId],
    enabled: () => !!toValue(transactionId),
    queryFn: async (): Promise<FuelTransaction | null> => {
      const id = toValue(transactionId);
      if (!id) return null;
      const { data, error } = await supabase
        .from("fuel_transactions")
        .select(
          "id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as FuelTransaction | null) ?? null;
    },
  });
}

/** Transition an anomaly's status via the API (version-checked, audited). */
export function useAnomalyTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string } & AnomalyTransition): Promise<void> => {
      const { id, ...body } = payload;
      const res = await apiFetch(`/api/anomalies/${id}/transition`, { method: "POST", body });
      if (!res.ok) {
        throw new Error(res.error?.message ?? "Could not update the anomaly");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anomalies"] }),
  });
}
