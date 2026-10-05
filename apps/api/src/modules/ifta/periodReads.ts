import type { SupabaseClient } from "@supabase/supabase-js";
import type { IftaJurisdictionTrucksResponse } from "@silvicom/shared";
import { readJurisdictionVehicleMiles } from "../samsara/index.js";
import { readJurisdictionFills } from "../fuel/index.js";

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
}

export async function readIftaPeriod(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  quarter: number,
): Promise<IftaPeriodRows> {
  const args = { p_org: orgId, p_year: year, p_quarter: quarter };
  const [jurisdictions, summaryRows] = await Promise.all([
    admin.rpc("ifta_period_jurisdictions", args),
    admin.rpc("ifta_period_summary", args),
  ]);
  if (jurisdictions.error) throw new Error(jurisdictions.error.message);
  if (summaryRows.error) throw new Error(summaryRows.error.message);
  return {
    jurisdictions: (jurisdictions.data ?? []) as Record<string, unknown>[],
    summary: ((summaryRows.data ?? []) as Record<string, unknown>[])[0] ?? null,
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
  const pad = (m: number) => String(m).padStart(2, "0");
  const fromDay = `${year}-${pad(months[0]!)}-01`;
  const toDayExclusive = quarter === 4 ? `${year + 1}-01-01` : `${year}-${pad(months[2]! + 1)}-01`;
  const [miles, fills] = await Promise.all([
    readJurisdictionVehicleMiles(admin, orgId, year, months, jurisdiction),
    readJurisdictionFills(admin, orgId, jurisdiction, fromDay, toDayExclusive),
  ]);

  const units = new Map<string, string | null>();
  const ids = [...new Set([...miles.map((m) => m.vehicleId), ...fills.flatMap((f) => (f.vehicleId ? [f.vehicleId] : []))])];
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

  return {
    jurisdiction,
    year,
    quarter,
    trucks: miles.map((m) => ({ ...m, unitNumber: units.get(m.vehicleId) ?? null })),
    fills,
    units: Object.fromEntries(units),
  };
}
