import { type Ref, computed, toValue } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Anomaly, AnomalyTransition, FuelTransaction } from "@silvicom/shared";
import { cardIsIdentifiable, isFullCardNumber, sameCardFill } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

/** Extended transaction row for the anomaly detail view (includes card/geo + fueling-event audit fields). */
export interface AnomalyTxnDetail extends FuelTransaction {
  card_ref: string | null;
  control_id: string | null;
  city: string | null;
  state: string | null;
  samsara_location_matched: boolean | null;
  // Fueling-event audit fields (migration 0028 + earlier recon columns).
  samsara_odometer: number | null;
  samsara_recon_at: string | null;
  samsara_recon_checked_at: string | null;
  samsara_recon_status: string | null;
  samsara_recon_error: string | null;
  samsara_recon_evidence_version: number | null;
  station_lat: number | null;
  station_lng: number | null;
  samsara_observed_state: string | null;
  samsara_observed_city: string | null;
  samsara_observed_address: string | null;
  samsara_observed_lat: number | null;
  samsara_observed_lng: number | null;
  samsara_fuel_pct_before: number | null;
  samsara_fuel_pct_after: number | null;
  fueling_time_basis: string | null;
}

/** A lighter sibling-fill row — other transactions on the same card in the same window. */
export interface SiblingFill {
  id: string;
  card_ref: string | null;
  control_id: string | null;
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
  "id, org_id, transaction_id, vehicle_id, rule_id, severity, status, message, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, disposition, disposition_by, disposition_at, version, fueled_at, created_at, updated_at";

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface AnomalyFilters {
  status?: string;
  severity?: string;
  /** Vehicle ids to narrow to. Absent means the whole fleet; a list means those trucks (FUEL-P1). */
  vehicleIds?: string[];
  ruleId?: string;
  reeferOnly?: boolean; // only cases whose correlated signals include a reefer axis
  from?: string; // YYYY-MM-DD (created_at ≥)
  to?: string; // YYYY-MM-DD (created_at ≤, end of day)
}

/** Anomaly queue, filtered, sorted by severity then recency (client-side sort for enum ranking). */
export function useAnomaliesQuery(filters: Ref<AnomalyFilters>) {
  return useQuery({
    queryKey: ["anomalies", filters],
    // Surface anomalies from background EFS ingestion + scoring without a manual reload. Matches the
    // dashboard cadence; Vue Query pauses polling when the tab is hidden, so it stays rate-friendly.
    refetchInterval: 120_000,
    queryFn: async (): Promise<Anomaly[]> => {
      const f = toValue(filters);
      let q = supabase
        .from("anomalies")
        .select(ANOMALY_COLS)
        .order("fueled_at", { ascending: false, nullsFirst: false })
        .limit(500);
      q = f.status ? q.eq("status", f.status) : q.neq("status", "superseded");
      if (f.severity) q = q.eq("severity", f.severity);
      if (f.vehicleIds?.length) q = q.in("vehicle_id", f.vehicleIds);
      if (f.ruleId) q = q.eq("rule_id", f.ruleId);
      // Reefer alerts live on their OWN tab: include ONLY reefer-axis cases there, and EXCLUDE them from the
      // main list (they're mostly false until the McLeod reefer-load feed lands, so they'd just be noise here).
      if (f.reeferOnly) q = q.contains("evidence", { axes: ["reefer"] });
      else q = q.not("evidence", "cs", '{"axes":["reefer"]}');
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
          "id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, city, state, card_ref, control_id, source, import_id, computed_mpg, has_anomaly, max_severity, ai_risk_level, samsara_location_matched, samsara_location_confidence, samsara_odometer, samsara_recon_at, samsara_recon_checked_at, samsara_recon_status, samsara_recon_error, samsara_recon_evidence_version, station_lat, station_lng, samsara_observed_state, samsara_observed_city, samsara_observed_address, samsara_observed_lat, samsara_observed_lng, samsara_fuel_pct_before, samsara_fuel_pct_after, fueling_time_basis, created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as AnomalyTxnDetail | null) ?? null;
    },
  });
}

/**
 * The fills that belong to the SAME PHYSICAL CARD within a ±windowHours window of fueledAt — the
 * sibling-fills table shown under a card_multi_vehicle alert.
 *
 * WP3c: this used to be a bare `.eq("card_ref", ref)`. Since EFS masks the PAN, that listed every
 * fill in the fleet whose card ends in the same 4 digits — so the evidence panel visually
 * *corroborated* the false alert with other drivers' fills, and simultaneously omitted this card's
 * own fills that were stored in the other (full-number) format. It now scans the same columns the
 * scorer scans and applies the identical `sameCardFill` identity test, so the UI and the engine can
 * never disagree about which fills are "this card's".
 */
export function useRelatedCardFills(
  cardRef: Ref<string | null | undefined>,
  controlId: Ref<string | null | undefined>,
  fueledAt: Ref<string | undefined>,
  _currentTxnId: Ref<string | null>,
  windowHours: Ref<number>,
) {
  const SIBLING_COLS =
    "id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, location_text, city, state, card_ref, control_id";
  return useQuery({
    queryKey: ["related_card_fills", cardRef, controlId, fueledAt, windowHours],
    enabled: () => !!toValue(fueledAt) && cardIsIdentifiable(toValue(cardRef), toValue(controlId)),
    queryFn: async (): Promise<SiblingFill[]> => {
      const ref = toValue(cardRef) ?? null;
      const ctrl = toValue(controlId) ?? null;
      const at = toValue(fueledAt);
      if (!at || !cardIsIdentifiable(ref, ctrl)) return [];
      const hrs = toValue(windowHours);
      const base = new Date(at).getTime();
      const start = new Date(base - hrs * 3_600_000).toISOString();
      const end   = new Date(base + hrs * 3_600_000).toISOString();

      const byId = new Map<string, SiblingFill>();
      const scans: { col: "card_ref" | "control_id"; val: string }[] = [];
      if (ctrl) scans.push({ col: "control_id", val: ctrl });
      if (ref && isFullCardNumber(ref)) scans.push({ col: "card_ref", val: ref });
      for (const scan of scans) {
        const { data, error } = await supabase
          .from("fuel_transactions")
          .select(SIBLING_COLS)
          .eq(scan.col, scan.val)
          .gte("fueled_at", start)
          .lte("fueled_at", end)
          .order("fueled_at", { ascending: true });
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as SiblingFill[]) byId.set(r.id, r);
      }
      return [...byId.values()]
        .filter((r) => sameCardFill({ cardRef: r.card_ref, controlId: r.control_id }, { cardRef: ref, controlId: ctrl }))
        .sort((a, b) => a.fueled_at.localeCompare(b.fueled_at));
    },
  });
}

/**
 * Map transaction_id → driver_id for a set of anomalies. Drives the reefer tab's Driver column without
 * denormalizing the driver onto every anomaly row — one batched query over the loaded anomalies' fills.
 */
export function useAnomalyTxnDrivers(anomalies: Ref<Anomaly[] | undefined>) {
  const ids = computed(() =>
    [...new Set((toValue(anomalies) ?? []).map((a) => a.transaction_id).filter(Boolean))].sort(),
  );
  return useQuery({
    queryKey: ["anomaly_txn_drivers", ids],
    enabled: () => ids.value.length > 0,
    queryFn: async (): Promise<Record<string, string | null>> => {
      const list = ids.value;
      if (!list.length) return {};
      const { data, error } = await supabase.from("fuel_transactions").select("id, driver_id").in("id", list);
      if (error) throw new Error(error.message);
      const m: Record<string, string | null> = {};
      for (const r of (data ?? []) as { id: string; driver_id: string | null }[]) m[r.id] = r.driver_id;
      return m;
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
