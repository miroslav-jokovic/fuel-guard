import type { SupabaseClient } from "@supabase/supabase-js";
import { metersToMiles } from "@silvicom/shared";

/**
 * The collector's read interface over its own IFTA mileage staging (D-SEP1 — nothing outside
 * samsara touches the raw table; the CPM harness asks HERE). Month-grained because the source is:
 * Samsara publishes jurisdiction miles per vehicle per calendar month.
 *
 * Sums total_meters across ALL jurisdictions including unrecognised ones — an unknown
 * jurisdiction's miles were still driven, and dropping them shrinks every denominator downstream
 * without anything saying so (D-IF7, the table's own rule).
 */
export async function readVehicleMonthlyMiles(
  admin: SupabaseClient,
  orgId: string,
  months: Array<{ year: number; month: number }>,
): Promise<Map<string, number>> {
  const byVehicle = new Map<string, number>();
  const PAGE = 1000;
  for (const { year, month } of months) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("samsara_ifta_jurisdiction_miles")
        .select("vehicle_id, total_meters")
        .eq("org_id", orgId)
        .eq("period_year", year)
        .eq("period_month", month)
        // Unordered .range() paging repeats/drops rows across pages — order by pk (financialReads lesson).
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`samsara_ifta_jurisdiction_miles read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ vehicle_id: string; total_meters: number | string }>;
      for (const r of rows) {
        byVehicle.set(r.vehicle_id, (byVehicle.get(r.vehicle_id) ?? 0) + metersToMiles(Number(r.total_meters)));
      }
      if (rows.length < PAGE) break;
    }
  }
  for (const [k, v] of byVehicle) byVehicle.set(k, Math.round(v * 10) / 10);
  return byVehicle;
}

/**
 * Measured trucks and miles per calendar month, for the coverage rule (G4/G10).
 *
 * `readVehicleMonthlyMiles` collapses several months into one per-vehicle total, which is what a
 * single-period denominator needs and is exactly wrong for coverage: a rollout gap in February is
 * invisible once February and July are added together. This keeps the months apart.
 */
export async function readMonthlyMileageByMonth(
  admin: SupabaseClient,
  orgId: string,
  months: Array<{ year: number; month: number }>,
): Promise<Map<string, { trucks: number; miles: number }>> {
  const out = new Map<string, { trucks: Set<string>; miles: number }>();
  const PAGE = 1000;
  for (const { year, month } of months) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const bucket = out.get(key) ?? { trucks: new Set<string>(), miles: 0 };
    out.set(key, bucket);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("samsara_ifta_jurisdiction_miles")
        .select("vehicle_id, total_meters")
        .eq("org_id", orgId)
        .eq("period_year", year)
        .eq("period_month", month)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`samsara_ifta_jurisdiction_miles read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{ vehicle_id: string; total_meters: number | string }>;
      for (const r of rows) {
        // A vehicle counts as measured when it has a row, even a zero-mile one: the row is the
        // evidence that the gateway reported, which is the question coverage asks.
        bucket.trucks.add(r.vehicle_id);
        bucket.miles += metersToMiles(Number(r.total_meters));
      }
      if (rows.length < PAGE) break;
    }
  }
  return new Map(
    [...out].map(([k, v]) => [k, { trucks: v.trucks.size, miles: Math.round(v.miles * 10) / 10 }]),
  );
}

