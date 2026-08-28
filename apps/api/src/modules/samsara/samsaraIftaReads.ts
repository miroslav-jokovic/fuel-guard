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
