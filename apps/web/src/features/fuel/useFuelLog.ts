import { type Ref, toValue } from "vue";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  derivePricePerGal,
  windowMilesFromAggregate,
  applyFuelLogFilters,
  fuelSearchTerm,
  MPG_PLAUSIBLE_MIN,
  MPG_PLAUSIBLE_MAX,
  type FillUpInput,
  type FuelLogFilters,
  type FuelTransaction,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { apiFetch } from "@/lib/api";
import { compressToWebp } from "./imageCompress";

// Note: payment_method (migration 0067) is intentionally NOT selected here — it isn't shown in the table,
// and selecting a not-yet-migrated column would break the whole read path. It's written on insert only.
const FUEL_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, odometer, miles_since_last, gallons, price_per_gal, total_cost, location_text, state, source, card_ref, computed_mpg, has_anomaly, max_severity, ai_risk_level, samsara_location_confidence, tank_type, case_level, case_score, case_signals, case_gates, created_at";

export const FUEL_PAGE_SIZE = 20;

/**
 * What narrows the fill list — defined in `@silvicom/shared` since FUEL-P2, because the EXPORT has to
 * apply the identical set (D-FUI15). Re-exported under the name every caller here already imports.
 */
export type FuelFilters = FuelLogFilters;

export interface FuelPage {
  rows: FuelTransaction[];
  total: number;
}

/** Fuel log, newest first, one page (20) with total count for page navigation. */
export function useFuelTransactions(filters: Ref<FuelFilters>, page: Ref<number>) {
  return useQuery({
    queryKey: ["fuel_transactions", filters, page],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FuelPage> => {
      const f = toValue(filters);
      const start = (toValue(page) - 1) * FUEL_PAGE_SIZE;
      // `is_canonical` is stated HERE rather than in the shared filters: it is what makes a row a
      // fill rather than a duplicate, so it belongs to the query's identity and not to the reader's
      // narrowing. The export states it in the same breath, for the same reason.
      const q = applyFuelLogFilters(
        supabase
          .from("fuel_transactions")
          .select(FUEL_COLS, { count: "exact" })
          .eq("is_canonical", true)
          .order(f.sortKey ?? "fueled_at", { ascending: f.sortKey ? f.sortDir !== "desc" : false })
          .range(start, start + FUEL_PAGE_SIZE - 1),
        f,
      );
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as FuelTransaction[], total: count ?? 0 };
    },
  });
}

export interface FuelRangeTotals {
  /** Fill-ups matching the filters (the whole set, not one page). */
  fillUps: number;
  /**
   * Of those, how many name a truck (`fills_with_vehicle`, migration 0297, FUEL-T5).
   *
   * This is not decoration beside `fillUps` — it is the number that reconciles two tiles on this page
   * that have always covered different sets. `totalMiles` below skips a fill with no `vehicle_id`
   * because there is no odometer span without a vehicle; `totalGallons` and `totalCost` count it.
   * Measured 2026-09-02: 300 of 14,868 canonical fills, so the difference is real and unstated.
   *
   * ⚠ **NULL when the function has not got the column yet, and never 0.** This is the one field on
   * this object whose absence and whose zero mean opposite things: 0 is "not one fill in this window
   * names a truck", which for a fleet is alarming and for a deploy window is a lie.
   * `lint:migration-ordering` reads COLUMNS and cannot see a function's return shape, so nothing
   * mechanical stops a reader reaching production in the nine minutes before its schema does. Null
   * makes that window render NOTHING, which is what the page said before this existed.
   */
  fillsWithVehicle: number | null;
  /** Fleet miles ACTUALLY driven inside the range: per-truck robust odometer span (max−min within range),
   *  summed. Not the sum of per-fill `miles_since_last` — that over-counts (each fill's delta reaches back
   *  to the truck's previous fill, usually BEFORE the range start). */
  totalMiles: number;
  totalGallons: number;
  totalCost: number;
  /** True if any matching fill carried a cost (so the UI can show "—" vs "$0" honestly). */
  hasCost: boolean;
  flagged: number;
  clear: number;
  /**
   * ⚠ **There is no `fleetMpg` here any more (M4, D-MPG1).**
   *
   * It was a gallon-weighted mean of per-fill `computed_mpg`, documented as "matches the dashboard's
   * fleetMpg" — an assertion about two independent code paths rather than a derivation, and one of
   * four copies of a definition whose numerator ran 1.31–2.41% below Samsara's own IFTA miles. The
   * Fills tab reads `GET /api/fueling/fleet-mpg` instead, scoped by `fleetMpgScope` to the filters a
   * truck-measured figure can honestly answer.
   *
   * `fuel_range_miles_inputs` (0290/0315) still returns `mpg_weighted`/`mpg_gallons` — an APPLIED
   * migration cannot be edited and the function is harmless — but nothing reads them.
   */
}

const n = (v: number | string | null): number | null => (v == null ? null : Number(v));

/**
 * Range-wide totals across every fill matching the filters (not just the current page). Miles are the
 * robust per-vehicle odometer span WITHIN the range (via the same `robustWindowMiles` the scoring engine
 * uses — OBD-preferred, regression- and typo-safe), so "Total miles driven in range" reflects distance
 * covered between the first and last in-range fill per truck, not the inflated sum of inter-fill deltas.
 */
export function useFuelRangeTotals(filters: Ref<FuelFilters>) {
  return useQuery({
    queryKey: ["fuel_range_totals", filters],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FuelRangeTotals> => {
      const f = toValue(filters);

      // ── The four figures that are pure addition: summed in the database (FUEL-T3a, migration 0289) ──
      // These used to be accumulated by the paging loop below, which made them silently dependent on
      // that loop finishing. PostgREST's `max_rows` is a server setting this code does not control and
      // this carrier is already fifteen pages into it; the day that ceiling moves, or a request fails
      // mid-loop, every one of these read LOW with no error beside it. There is no page here, so there
      // is no page to be capped.
      const { data: sums, error: sumErr } = await supabase.rpc("fuel_range_totals", {
        p_from: f.from ?? null,
        p_to: f.to ?? null,
        // Migration 0312. A LIST, so the tiles and the rows beneath them answer for the same trucks;
        // `null` for the whole fleet, and an empty array for "the units named are not in this fleet".
        p_vehicles: f.vehicleIds ?? null,
        p_driver: f.driverId ?? null,
        p_tank_type: f.tankType ?? null,
        // The SAME sanitised term the list uses — see `fuelSearchTerm`. A tile filtering on a different
        // string than the rows beneath it is the disagreement this step exists to end.
        p_search: fuelSearchTerm(f),
        p_search_vehicles: f.searchVehicleIds?.length ? f.searchVehicleIds : null,
        p_search_drivers: f.searchDriverIds?.length ? f.searchDriverIds : null,
      });
      if (sumErr) throw new Error(sumErr.message);
      // `returns table` gives PostgREST an array; one row, always.
      const t = (Array.isArray(sums) ? sums[0] : sums) as {
        fills: number; gallons: number | string; spend: number | string;
        has_cost: boolean; flagged: number; clear: number;
        // 0297, and OPTIONAL in this type on purpose — see `fillsWithVehicle` above for why its
        // absence must not collapse to 0.
        fills_with_vehicle?: number | null;
      } | null;

      // ── The one that is JUDGEMENT — fed by a measurement, not by a page (FUEL-T3b, 0290) ─────────
      // "THIS SUMS. IT DOES NOT DERIVE." `robustWindowMiles` prefers an OBD span, falls back to the
      // entered span only when it is monotonic within ±1, and returns null rather than 0 for a
      // non-advancing window. None of that moved into SQL, and none of it may: T3b's finding is that
      // the database can return the MEASUREMENTS those rules judge — spans, counts, and the worst
      // backward step — without ever knowing the thresholds.
      //
      // The band is still handed in because the function's signature takes it (0315), and it still
      // gates which fills the function counts. It no longer feeds a fleet MPG: M4 moved that figure
      // onto `GET /api/fueling/fleet-mpg`, whose miles come from odometer readings rather than from
      // the fuel. There is exactly one definition of the band and it lives in `@silvicom/shared`.
      //
      // The paging loop this replaces is gone. Every tile on this page is now independent of how many
      // fills there are, which is what FUEL-T3a set out to do and could only half-finish.
      const { data: perVehicle, error: milesErr } = await supabase.rpc("fuel_range_miles_inputs", {
        p_mpg_min: MPG_PLAUSIBLE_MIN,
        p_mpg_max: MPG_PLAUSIBLE_MAX,
        p_from: f.from ?? null,
        p_to: f.to ?? null,
        p_vehicles: f.vehicleIds ?? null,
        p_driver: f.driverId ?? null,
        p_tank_type: f.tankType ?? null,
        p_search: fuelSearchTerm(f),
        p_search_vehicles: f.searchVehicleIds?.length ? f.searchVehicleIds : null,
        p_search_drivers: f.searchDriverIds?.length ? f.searchDriverIds : null,
      });
      if (milesErr) throw new Error(milesErr.message);

      let totalMiles = 0;
      for (const v of (perVehicle ?? []) as {
        vehicle_id: string | null;
        obd_count: number; obd_min: number | string | null; obd_max: number | string | null;
        entered_count: number; entered_min: number | string | null; entered_max: number | string | null;
        entered_worst_step: number | string | null;
        // 0316, and OPTIONAL for the same reason `fills_with_vehicle` is nullable above: a function's
        // return shape is invisible to `lint:migration-ordering`, so this reader is served for about
        // nine minutes by a database that does not have these yet. `undefined` reaches
        // `windowMilesFromAggregate` as "not taught the ends yet" and it answers exactly as it did
        // before — where `false` would blank this tile for the whole window.
        obd_covers_ends?: boolean | null;
        entered_covers_ends?: boolean | null;
      }[]) {
        if (!v.vehicle_id) continue; // a fill with no truck has no odometer span to contribute
        totalMiles +=
          windowMilesFromAggregate({
            obdCount: Number(v.obd_count),
            obdMin: n(v.obd_min),
            obdMax: n(v.obd_max),
            enteredCount: Number(v.entered_count),
            enteredMin: n(v.entered_min),
            enteredMax: n(v.entered_max),
            enteredWorstStep: n(v.entered_worst_step),
            // ⚠ `?? undefined`, never `?? false`. A source may only answer for a window whose ends it
            // reaches (2026-09-05); a null column is the database not having been asked, and reading
            // that as "the ends are not covered" would withhold every truck's miles until 0316 lands.
            obdCoversEnds: v.obd_covers_ends ?? undefined,
            enteredCoversEnds: v.entered_covers_ends ?? undefined,
          }).miles ?? 0; // null (data-quality) → contributes 0, exactly as before
      }

      return {
        fillUps: Number(t?.fills ?? 0),
        // `?? 0` here would be the confident lie. See the field's doc comment.
        fillsWithVehicle: t?.fills_with_vehicle == null ? null : Number(t.fills_with_vehicle),
        totalMiles,
        totalGallons: Number(t?.gallons ?? 0),
        totalCost: Number(t?.spend ?? 0),
        hasCost: t?.has_cost ?? false,
        flagged: Number(t?.flagged ?? 0),
        clear: Number(t?.clear ?? 0),
      };
    },
  });
}

/** Create a fill-up: optional compressed receipt upload, then insert (engine scoring lands in Phase 5). */
export function useCreateFillUp() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async ({ input, file }: { input: FillUpInput; file?: File | null }): Promise<void> => {
      if (!session.orgId) throw new Error("No organization in session");

      let receiptPath: string | null = null;
      if (file) {
        const blob = await compressToWebp(file);
        const path = `${session.orgId}/${input.vehicle_id}/${input.id}.webp`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, blob, { contentType: "image/webp", upsert: true });
        if (upErr) throw new Error(`Receipt upload failed: ${upErr.message}`);
        receiptPath = path;
      }

      const row = {
        id: input.id,
        org_id: session.orgId,
        vehicle_id: input.vehicle_id,
        driver_id: input.driver_id ?? null,
        fueled_at: input.fueled_at,
        odometer: input.odometer ?? null,
        gallons: input.gallons,
        total_cost: input.total_cost ?? null,
        price_per_gal: derivePricePerGal(input.gallons, input.total_cost ?? null),
        location_text: input.location_text ?? null,
        payment_method: input.payment_method ?? null,
        receipt_path: receiptPath,
        source: "manual",
        entered_by: session.userId,
      };
      const { error } = await supabase.from("fuel_transactions").insert(row);
      if (error) throw new Error(error.message);

      // Best-effort server-side scoring (anomaly engine). The fill-up is saved regardless.
      try {
        await apiFetch(`/api/transactions/${input.id}/score`, { method: "POST" });
      } catch {
        /* scoring can be retried; never block the save */
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_transactions"] });
      qc.invalidateQueries({ queryKey: ["anomalies"] });
    },
  });
}
