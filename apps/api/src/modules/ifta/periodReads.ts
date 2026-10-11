import type { SupabaseClient } from "@supabase/supabase-js";
import type { IftaJurisdictionTrucksResponse, IftaPeriodReceipts } from "@silvicom/shared";
import { readJurisdictionVehicleMiles } from "../samsara/index.js";
import { readJurisdictionFills } from "../fuel/index.js";
import { quarterWindow, readIftaJurisdictionReceipts, readIftaPeriodReceipts } from "./receiptReads.js";

/**
 * The quarterly IFTA reads, made server-side. Until program step P1.10 (2026-08-27) the harness
 * was a browser hook calling the 0256/0258 RPCs straight into the samsara collector's staging
 * tables — the exact browser→staging path ARCHITECTURE §1 forbids. The RPCs themselves are
 * unchanged (applied migrations are never edited); what changed is WHO calls them: this module,
 * with the service role, passing `p_org` explicitly because a service-role call carries no JWT
 * claim for the in-function `coalesce(p_org, auth_org_id())` default to fall back on.
 */
export interface IftaPeriodRows {
  jurisdictions: Record<string, unknown>[];
  summary: Record<string, unknown> | null;
  /**
   * McLeod's hand-keyed receipts per jurisdiction (IP6), card duplicates dropped. Beside the RPC's
   * card gallons rather than inside them: the browser adds them as their own source, so the page can
   * say how much of "gallons bought" rests on receipts.
   */
  receipts: IftaPeriodReceipts;
}

export async function readIftaPeriod(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  quarter: number,
): Promise<IftaPeriodRows> {
  const args = { p_org: orgId, p_year: year, p_quarter: quarter };
  const [jurisdictions, summaryRows, receipts] = await Promise.all([
    admin.rpc("ifta_period_jurisdictions", args),
    admin.rpc("ifta_period_summary", args),
    readIftaPeriodReceipts(admin, orgId, year, quarter),
  ]);
  if (jurisdictions.error) throw new Error(jurisdictions.error.message);
  if (summaryRows.error) throw new Error(summaryRows.error.message);
  return {
    jurisdictions: (jurisdictions.data ?? []) as Record<string, unknown>[],
    summary: ((summaryRows.data ?? []) as Record<string, unknown>[])[0] ?? null,
    receipts,
  };
}

/**
 * One jurisdiction's quarter, per truck — the drill-down behind a ledger row: the miles each truck
 * drove there and the fills it bought there. The miles come through samsara's own read interface
 * (D-SEP1: nothing outside the collector touches its staging), the fills through fuel's, the unit
 * numbers from `vehicles` — all scoped to `orgId` by hand because the service role bypasses RLS.
 * Units stay Samsara's; `iftaJurisdictionTrucks` in `@silvicom/shared` converts and joins (D-IF1).
 */
export async function readIftaJurisdictionTrucks(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  quarter: number,
  jurisdiction: string,
): Promise<IftaJurisdictionTrucksResponse> {
  const months = [1, 2, 3].map((i) => (quarter - 1) * 3 + i);
  const { fromDay, toDayExclusive } = quarterWindow(year, quarter);
  const [miles, fills] = await Promise.all([
    readJurisdictionVehicleMiles(admin, orgId, year, months, jurisdiction),
    readJurisdictionFills(admin, orgId, jurisdiction, fromDay, toDayExclusive),
  ]);
  const receipts = await readIftaJurisdictionReceipts(admin, orgId, fromDay, toDayExclusive, jurisdiction, fills);

  const units = await readUnitNumbers(admin, orgId, [
    ...miles.map((m) => m.vehicleId),
    ...[...fills, ...receipts.kept].flatMap((f) => (f.vehicleId ? [f.vehicleId] : [])),
  ]);

  return {
    jurisdiction,
    year,
    quarter,
    trucks: miles.map((m) => ({ ...m, unitNumber: units.get(m.vehicleId) ?? null })),
    fills,
    units: Object.fromEntries(units),
    receipts: receipts.kept,
    receiptDuplicates: receipts.duplicates.length,
  };
}

/** vehicle id → unit number, for the trucks an IFTA read names. Retired trucks included: they own their quarter's miles. */
export async function readUnitNumbers(admin: SupabaseClient, orgId: string, vehicleIds: string[]): Promise<Map<string, string | null>> {
  const units = new Map<string, string | null>();
  const ids = [...new Set(vehicleIds)];
  // In chunks: a PostgREST `in` list rides in the URL, and a large fleet's ids would overrun it.
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("vehicles")
      .select("id, unit_number")
      .eq("org_id", orgId)
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`vehicles read failed: ${error.message}`);
    for (const v of (data ?? []) as Array<{ id: string; unit_number: string | null }>) {
      units.set(v.id, v.unit_number?.trim() || null);
    }
  }
  return units;
}
