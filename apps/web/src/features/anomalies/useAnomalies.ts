import { type Ref, toValue } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Anomaly, AnomalyTransition, FuelTransaction } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

/** Extended transaction row for the anomaly detail view (includes card/geo fields). */
export interface AnomalyTxnDetail extends FuelTransaction {
  card_ref: string | null;
  city: string | null;
  state: string | null;
  samsara_location_matched: boolean | null;
}

/** A lighter sibling-fill row — other transactions on the same card in the same window. */
export interface SiblingFill {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  fueled_at: string;
  odometer: number | null;
  gallons: number;
  price_per_gal: number | null;
  location_text: string | null;
  city: string | null;
  state: string | null;
}

const ANOMALY_COLS =
  "id, org_id, transaction_id, vehicle_id, rule_id, severity, status, message, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, fueled_at, created_at, updated_at";

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface AnomalyFilters {
  status?: string;
  severity?: string;
  vehicleId?: string;
  ruleId?: string;
  from?: string; // YYYY-MM-DD (created_at ≥)
  to?: string; // YYYY-MM-DD (created_at ≤, end of day)
}

/** Anomaly queue, filtered, sorted by severity then recency (client-side sort for enum ranking). */
export function useAnomaliesQuery(filters: Ref<AnomalyFilters>) {
  return useQuery({
    queryKey: ["anomalies", filters],
    queryFn: async (): Promise<Anomaly[]> => {
      const f = toValue(filters);
      let q = supabase
        .from("anomalies")
        .select(ANOMALY_COLS)
        .order("fueled_at", { ascending: false, nullsFirst: false })
        .limit(500);
      q = f.status ? q.eq("status", f.status) : q.neq("status", "superseded");
      if (f.severity) q = q.eq("severity", f.severity);
      if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
      if (f.ruleId) q = q.eq("rule_id", f.ruleId);
      // Filter by the FUELING date (not detection time, which a rebuild resets to "today").
      if (f.from) q = q.gte("fueled_at", `${f.from}T00:00:00`);
      if (f.to) q = q.lte("fueled_at", `${f.to}T23:59:59`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const when = (a: Anomaly) => a.fueled_at ?? a.created_at;
      return ((data ?? []) as Anomaly[]).sort(
        (a, b) =>
          (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
          +new Date(when(b)) - +new Date(when(a)),
      );
    },
  });
}

/** The fuel transaction behind an anomaly (for the detail view — includes card/geo fields). */
export function useTransaction(transactionId: Ref<string | null>) {
  return useQuery({
    queryKey: ["fuel_transaction", transactionId],
    enabled: () => !!toValue(transactionId),
    queryFn: async (): Promise<AnomalyTxnDetail | null> => {
      const id = toValue(transactionId);
      if (!id) return null;
      const { data, error } = await supabase
        .from("fuel_transactions")
        .select(
          "id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, city, state, card_ref, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, samsara_location_matched, created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as AnomalyTxnDetail | null) ?? null;
    },
  });
}

/**
 * All fuel transactions sharing the same card_ref within a ±windowHours window of fueledAt.
 * Used to render the sibling-fills table for card_multi_vehicle alerts.
 */
export function useRelatedCardFills(
  cardRef: Ref<string | null | undefined>,
  fueledAt: Ref<string | undefined>,
  _currentTxnId: Ref<string | null>,
  windowHours: Ref<number>,
) {
  return useQuery({
    queryKey: ["related_card_fills", cardRef, fueledAt, windowHours],
    enabled: () => !!toValue(cardRef) && !!toValue(fueledAt),
    queryFn: async (): Promise<SiblingFill[]> => {
      const ref = toValue(cardRef);
      const at = toValue(fueledAt);
      if (!ref || !at) return [];
      const hrs = toValue(windowHours);
      const base = new Date(at).getTime();
      const start = new Date(base - hrs * 3_600_000).toISOString();
      const end   = new Date(base + hrs * 3_600_000).toISOString();
      const { data, error } = await supabase
        .from("fuel_transactions")
        .select("id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, location_text, city, state")
        .eq("card_ref", ref)
        .gte("fueled_at", start)
        .lte("fueled_at", end)
        .order("fueled_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as SiblingFill[];
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
