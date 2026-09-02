import { type Ref, toValue } from "vue";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  derivePricePerGal,
  windowMilesFromAggregate,
  MPG_PLAUSIBLE_MIN,
  MPG_PLAUSIBLE_MAX,
  type FillUpInput,
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

export interface FuelFilters {
  vehicleId?: string;
  driverId?: string;
  /**
   * The window, as CALENDAR DAYS — both ends inclusive, both `YYYY-MM-DD`, and both meaning the
   * STATION-LOCAL business date (D-FUI11, migration 0287). Not an instant, and deliberately not one:
   * see the note above the filters in `useFuelTransactions`.
   */
  from?: string;
  to?: string;
  tankType?: "tractor" | "reefer"; // filter tractor vs reefer fills
  /** Free-text smart search — matched server-side against location & card, plus vehicle/driver via the
   *  page-resolved id lists below (so a unit number or driver name in the box narrows the log too). */
  search?: string;
  searchVehicleIds?: string[]; // vehicle ids whose unit matched `search` (resolved on the page)
  searchDriverIds?: string[]; // driver ids whose name matched `search` (resolved on the page)
  sortKey?: string; // column to order by (server-side)
  sortDir?: "asc" | "desc";
}

/**
 * The search term, sanitised ONCE, for both the list and the tiles above it.
 *
 * `%,()` are stripped because PostgREST's `.or(...)` grammar is comma- and paren-delimited and treats
 * `%` as a wildcard — an unstripped term is a syntax error or a filter that matches the whole fleet.
 * `fuel_range_totals` does not need the strip (0289 escapes the term server-side), but it must be given
 * the SAME term anyway: the tiles sit directly above the table, and a tile counting a different set
 * than the rows beneath it is precisely the disagreement FUEL-T3a exists to end. One sanitiser, one
 * term, two callers.
 */
export function searchTerm(f: FuelFilters): string | null {
  if (!f.search) return null;
  const t = f.search.replace(/[%,()]/g, "").trim();
  return t || null;
}

/** Build the PostgREST `.or(...)` term for the smart search across location/card + resolved vehicle/driver. */
function searchOr(f: FuelFilters): string | null {
  const t = searchTerm(f);
  if (!t) return null;
  const ors = [`location_text.ilike.%${t}%`, `card_ref.ilike.%${t}%`];
  if (f.searchVehicleIds?.length) ors.push(`vehicle_id.in.(${f.searchVehicleIds.join(",")})`);
  if (f.searchDriverIds?.length) ors.push(`driver_id.in.(${f.searchDriverIds.join(",")})`);
  return ors.join(",");
}

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
      let q = supabase
        .from("fuel_transactions")
        .select(FUEL_COLS, { count: "exact" })
        .eq("is_canonical", true)
        .order(f.sortKey ?? "fueled_at", { ascending: f.sortKey ? f.sortDir !== "desc" : false })
        .range(start, start + FUEL_PAGE_SIZE - 1);
      if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
      if (f.driverId) q = q.eq("driver_id", f.driverId);
      if (f.tankType) q = q.eq("tank_type", f.tankType);
      // FUEL-T1 / D-FUI11. This filtered `fueled_at` — a UTC INSTANT — while the table beside it
      // rendered that same instant in the STATION's zone. Two derivations of one day, disagreeing
      // whenever the station's local day differs from the UTC day: measured 2026-09-01, 1,833 of
      // 14,749 fills (12.4%), of which 57 ($28,430.70) sat in the neighbouring MONTH's total. A
      // California fill at 18:00 on 31 August displayed as "Aug 31" and fell outside an August
      // window. `business_date` is the stored station-local day (0287, trigger-maintained), so the
      // filter and the display now read the SAME derivation instead of agreeing by luck.
      if (f.from) q = q.gte("business_date", f.from);
      if (f.to) q = q.lte("business_date", f.to);
      const or = searchOr(f);
      if (or) q = q.or(or);
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
  /** Gallon-weighted mean of plausible per-fill MPG across the range (matches the dashboard's fleetMpg). */
  fleetMpg: number | null;
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
        p_vehicle: f.vehicleId ?? null,
        p_driver: f.driverId ?? null,
        p_tank_type: f.tankType ?? null,
        // The SAME sanitised term the list uses — see `searchTerm`. A tile filtering on a different
        // string than the rows beneath it is the disagreement this step exists to end.
        p_search: searchTerm(f),
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

      // ── The two that are JUDGEMENT — now fed by a measurement, not by a page (FUEL-T3b, 0290) ─────
      // "THIS SUMS. IT DOES NOT DERIVE." Fleet MPG applies a plausibility band, and `robustWindowMiles`
      // prefers an OBD span, falls back to the entered span only when it is monotonic within ±1, and
      // returns null rather than 0 for a non-advancing window. None of that moved into SQL, and none of
      // it may: T3b's finding is that the database can return the MEASUREMENTS those rules judge —
      // spans, counts, and the worst backward step — without ever knowing the thresholds. The band
      // travels the other way, as a required argument, so there is exactly one definition of it and it
      // lives in `@silvicom/shared`.
      //
      // The paging loop this replaces is gone. Every tile on this page is now independent of how many
      // fills there are, which is what FUEL-T3a set out to do and could only half-finish.
      const { data: perVehicle, error: milesErr } = await supabase.rpc("fuel_range_miles_inputs", {
        p_mpg_min: MPG_PLAUSIBLE_MIN,
        p_mpg_max: MPG_PLAUSIBLE_MAX,
        p_from: f.from ?? null,
        p_to: f.to ?? null,
        p_vehicle: f.vehicleId ?? null,
        p_driver: f.driverId ?? null,
        p_tank_type: f.tankType ?? null,
        p_search: searchTerm(f),
        p_search_vehicles: f.searchVehicleIds?.length ? f.searchVehicleIds : null,
        p_search_drivers: f.searchDriverIds?.length ? f.searchDriverIds : null,
      });
      if (milesErr) throw new Error(milesErr.message);

      let totalMiles = 0;
      let mpgWeighted = 0;
      let mpgGallons = 0;
      for (const v of (perVehicle ?? []) as {
        vehicle_id: string | null;
        obd_count: number; obd_min: number | string | null; obd_max: number | string | null;
        entered_count: number; entered_min: number | string | null; entered_max: number | string | null;
        entered_worst_step: number | string | null;
        mpg_weighted: number | string; mpg_gallons: number | string;
      }[]) {
        // Fleet MPG counts every fill, INCLUDING those attributed to no truck — the loop this replaced
        // accumulated MPG before it skipped them, and that behaviour is preserved deliberately.
        mpgWeighted += Number(v.mpg_weighted);
        mpgGallons += Number(v.mpg_gallons);
        if (!v.vehicle_id) continue; // …but a fill with no truck has no odometer span to contribute
        totalMiles +=
          windowMilesFromAggregate({
            obdCount: Number(v.obd_count),
            obdMin: n(v.obd_min),
            obdMax: n(v.obd_max),
            enteredCount: Number(v.entered_count),
            enteredMin: n(v.entered_min),
            enteredMax: n(v.entered_max),
            enteredWorstStep: n(v.entered_worst_step),
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
        fleetMpg: mpgGallons > 0 ? mpgWeighted / mpgGallons : null,
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
