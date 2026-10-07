import type { SupabaseClient } from "@supabase/supabase-js";
import { metersToMiles, type IftaTruckStateMilesRaw } from "@silvicom/shared";

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


/** One truck's miles in one jurisdiction over a set of months, in Samsara's units (D-IF1). */
export interface JurisdictionVehicleMiles {
  vehicleId: string;
  taxableMeters: number;
  totalMeters: number;
  /** Distinct months, of those asked for, in which Samsara reported this truck in the jurisdiction. */
  months: number;
}

/**
 * Every truck Samsara reported in ONE jurisdiction over the given months, summed per truck — the
 * drill-down behind a row of the IFTA ledger, which `ifta_period_jurisdictions` (0256) has already
 * folded across trucks.
 *
 * Summed per `vehicle_id`, never read as one row per truck: since 0357/0358 a truck whose gateway
 * was swapped mid-month carries one row per DEVICE (unit 732, August 2026), and taking either row
 * alone would show a third of its miles. Metres stay metres here; the browser converts them with the
 * one shared `milesFromMeters`, as the ledger does, so the drill-down and the row it opened from
 * cannot disagree on a conversion.
 *
 * Volume, measured on production 2026-10-05: the largest jurisdiction-quarter (TX, 2026 Q3) is
 * 184 trucks, so a few hundred rows — one page in practice, still paged so a larger fleet is right.
 */
export async function readJurisdictionVehicleMiles(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  months: number[],
  jurisdiction: string,
): Promise<JurisdictionVehicleMiles[]> {
  const byVehicle = new Map<string, { taxable: number; total: number; months: Set<number> }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("samsara_ifta_jurisdiction_miles")
      .select("vehicle_id, period_month, taxable_meters, total_meters")
      .eq("org_id", orgId)
      .eq("period_year", year)
      .in("period_month", months)
      .eq("jurisdiction", jurisdiction)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`samsara_ifta_jurisdiction_miles read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      vehicle_id: string;
      period_month: number;
      taxable_meters: number | string;
      total_meters: number | string;
    }>;
    for (const r of rows) {
      const v = byVehicle.get(r.vehicle_id) ?? { taxable: 0, total: 0, months: new Set<number>() };
      v.taxable += Number(r.taxable_meters);
      v.total += Number(r.total_meters);
      v.months.add(Number(r.period_month));
      byVehicle.set(r.vehicle_id, v);
    }
    if (rows.length < PAGE) break;
  }
  return [...byVehicle].map(([vehicleId, v]) => ({
    vehicleId,
    taxableMeters: v.taxable,
    totalMeters: v.total,
    months: v.months.size,
  }));
}

/**
 * Every truck's miles in every jurisdiction over the given months, summed per (truck, jurisdiction):
 * the miles grid of the IFTA return export (IFTA-PRECISION-PLAN IP9). The same rows
 * `ifta_period_jurisdictions` (0256) sums with no predicate beyond org, year and month, so the grid's
 * column totals are the ledger's miles. Summed per `vehicle_id` for the reason the drill-down above
 * gives (one row per DEVICE since 0357/0358). Volume, measured 2026-10-05: ~2,600 (truck,
 * jurisdiction) rows a quarter, a few pages.
 */
export async function readQuarterTruckStateMiles(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  months: number[],
): Promise<IftaTruckStateMilesRaw[]> {
  const by = new Map<string, IftaTruckStateMilesRaw>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("samsara_ifta_jurisdiction_miles")
      .select("vehicle_id, jurisdiction, taxable_meters, total_meters")
      .eq("org_id", orgId)
      .eq("period_year", year)
      .in("period_month", months)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`samsara_ifta_jurisdiction_miles read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      vehicle_id: string;
      jurisdiction: string;
      taxable_meters: number | string;
      total_meters: number | string;
    }>;
    for (const r of rows) {
      const jurisdiction = r.jurisdiction.trim().toUpperCase();
      const key = `${r.vehicle_id}|${jurisdiction}`;
      const a = by.get(key) ?? { vehicleId: r.vehicle_id, jurisdiction, taxableMeters: 0, totalMeters: 0 };
      a.taxableMeters += Number(r.taxable_meters);
      a.totalMeters += Number(r.total_meters);
      by.set(key, a);
    }
    if (rows.length < PAGE) break;
  }
  return [...by.values()];
}
