/**
 * The daily fuel-spend rollup, read back (migration 0244).
 *
 * `fuel_spend_days` carries an org-scoped select policy and no client write policy at all, so the
 * browser reads its own carrier's spend days straight from PostgREST and cannot assert one. Everything
 * the trend and the bridge show is derived from these rows by the pure functions in
 * `@fuelguard/shared` — the page does no arithmetic of its own, so a figure here and a figure in a
 * test cannot drift apart.
 *
 * ── WHY THE WINDOW IS BOUNDED ────────────────────────────────────────────────────────────────────
 * The grain is one row per truck per day: roughly 165 rows a day, so a year is ~60,000 and PostgREST
 * caps a response at 1,000. A bounded window keeps the page honest about what it is fetching instead
 * of quietly paging sixty times on load. The reader picks the window; `useSpendFilters` owns it.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { SpendDay } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

export interface SpendQueryFilters {
  from: string;
  to: string;
  /** Empty means the whole fleet. Narrowing drops the unattributed row, which belongs to no truck. */
  vehicleIds: string[];
}

export function useSpendDaysQuery(filters: Ref<SpendQueryFilters>) {
  return useQuery({
    queryKey: ["fuel_spend_days", filters],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpendDay[]> => {
      const f = filters.value;
      const out: SpendDay[] = [];
      for (let start = 0; ; start += PAGE) {
        let q = supabase
          .from("fuel_spend_days")
          .select(
            "day, vehicle_id, fills, gallons_tractor, gallons_reefer, gallons_def, spend_tractor, spend_reefer, spend_def, miles, mpg_gallons, miles_rejected, drive_sec, idle_sec, off_sec, coverage_sec",
          )
          .gte("day", f.from)
          .lte("day", f.to);
        // Narrowed to specific trucks, the unattributed row is deliberately excluded: it is fuel that
        // belongs to no truck, so it cannot belong to the ones asked for.
        if (f.vehicleIds.length) q = q.in("vehicle_id", f.vehicleIds);
        const { data, error } = await q.order("day", { ascending: true }).range(start, start + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Record<string, unknown>[];
        for (const r of batch) {
          out.push({
            day: String(r.day),
            vehicleId: r.vehicle_id == null ? null : String(r.vehicle_id),
            fills: num(r.fills),
            gallonsTractor: num(r.gallons_tractor),
            gallonsReefer: num(r.gallons_reefer),
            gallonsDef: num(r.gallons_def),
            spendTractor: num(r.spend_tractor),
            spendReefer: num(r.spend_reefer),
            spendDef: num(r.spend_def),
            miles: num(r.miles),
            mpgGallons: num(r.mpg_gallons),
            milesRejected: num(r.miles_rejected),
            driveSec: num(r.drive_sec),
            idleSec: num(r.idle_sec),
            offSec: num(r.off_sec),
            coverageSec: num(r.coverage_sec),
          });
        }
        if (batch.length < PAGE) break;
      }
      return out;
    },
  });
}
