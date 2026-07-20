import { type Ref, toValue } from "vue";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/vue-query";
import { derivePricePerGal, type FillUpInput, type FuelTransaction } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { apiFetch } from "@/lib/api";
import { compressToWebp } from "./imageCompress";

// Note: payment_method (migration 0067) is intentionally NOT selected here — it isn't shown in the table,
// and selecting a not-yet-migrated column would break the whole read path. It's written on insert only.
const FUEL_COLS =
  "id, org_id, vehicle_id, driver_id, fueled_at, odometer, miles_since_last, gallons, price_per_gal, total_cost, location_text, state, source, card_ref, computed_mpg, has_anomaly, max_severity, ai_risk_level, samsara_location_confidence, tank_type, created_at";

export const FUEL_PAGE_SIZE = 20;

export interface FuelFilters {
  vehicleId?: string;
  driverId?: string;
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
  tankType?: "tractor" | "reefer"; // filter tractor vs reefer fills
  /** Free-text smart search — matched server-side against location & card, plus vehicle/driver via the
   *  page-resolved id lists below (so a unit number or driver name in the box narrows the log too). */
  search?: string;
  searchVehicleIds?: string[]; // vehicle ids whose unit matched `search` (resolved on the page)
  searchDriverIds?: string[]; // driver ids whose name matched `search` (resolved on the page)
  sortKey?: string; // column to order by (server-side)
  sortDir?: "asc" | "desc";
}

/** Build the PostgREST `.or(...)` term for the smart search across location/card + resolved vehicle/driver. */
function searchOr(f: FuelFilters): string | null {
  if (!f.search) return null;
  const t = f.search.replace(/[%,()]/g, "").trim();
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
        .order(f.sortKey ?? "fueled_at", { ascending: f.sortKey ? f.sortDir !== "desc" : false })
        .range(start, start + FUEL_PAGE_SIZE - 1);
      if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
      if (f.driverId) q = q.eq("driver_id", f.driverId);
      if (f.tankType) q = q.eq("tank_type", f.tankType);
      if (f.from) q = q.gte("fueled_at", f.from);
      if (f.to) q = q.lte("fueled_at", f.to);
      const or = searchOr(f);
      if (or) q = q.or(or);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as FuelTransaction[], total: count ?? 0 };
    },
  });
}

export interface FuelRangeTotals {
  /** Sum of stored per-fill miles (odometer delta between fuelings) across ALL matching fills. */
  totalMiles: number;
  totalGallons: number;
}

/**
 * Range-wide totals across every fill matching the filters (not just the current page). Pages through
 * two small columns and sums them, so "Total miles" reflects the whole selected date range / vehicle.
 */
export function useFuelRangeTotals(filters: Ref<FuelFilters>) {
  return useQuery({
    queryKey: ["fuel_range_totals", filters],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FuelRangeTotals> => {
      const f = toValue(filters);
      const PAGE = 1000;
      let totalMiles = 0;
      let totalGallons = 0;
      for (let start = 0; ; start += PAGE) {
        let q = supabase.from("fuel_transactions").select("miles_since_last, gallons").range(start, start + PAGE - 1);
        if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
        if (f.driverId) q = q.eq("driver_id", f.driverId);
        if (f.tankType) q = q.eq("tank_type", f.tankType);
        if (f.from) q = q.gte("fueled_at", f.from);
        if (f.to) q = q.lte("fueled_at", f.to);
        const or = searchOr(f);
        if (or) q = q.or(or);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as { miles_since_last: number | string | null; gallons: number | string | null }[];
        for (const r of batch) {
          if (r.miles_since_last != null) totalMiles += Number(r.miles_since_last);
          if (r.gallons != null) totalGallons += Number(r.gallons);
        }
        if (batch.length < PAGE) break;
      }
      return { totalMiles, totalGallons };
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
