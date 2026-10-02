/**
 * The Fuel Costs report's data (FS1, D-FSV1..6 of docs/plans/fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md).
 *
 * Two windows — the picked range and the previous range of equal length (D-FSV3) — each summed per
 * day × network × tank by `fuel_report_days` (migration 0405), and the places the fleet fuelled for
 * the state and location menus. SQL returns the sums; `fuelReportTotals` in `@silvicom/shared` makes
 * every ratio from them, so the page and anything else reading this answer can't disagree.
 *
 * ORG-FILTERED EXPLICITLY: `admin` is the service role and bypasses RLS, so `p_org` is the only tenant
 * boundary these reads have (D-FC1, 0247). The in-network brands come from the carrier's
 * `route_fuel_settings.preferred_brands` through `readFuelPolicy` — the list the planner routes to —
 * and are passed into SQL, which has no default of its own (D-FSV2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fuelReportTotals,
  previousFuelReportRange,
  type FuelNetwork,
  type FuelReportDay,
  type FuelReportTotals,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { readFuelPolicy } from "./fuelSpendLines.js";

export interface FuelReportFilterArgs {
  vehicleIds: string[];
  states: string[];
  siteIds: string[];
  networks: FuelNetwork[];
}

export interface FuelReportSite {
  stationId: string | null;
  brand: string | null;
  site: string | null;
  city: string | null;
  state: string | null;
  fills: number;
  gallons: number;
}

export interface FuelReportWindow {
  from: string;
  to: string;
  days: FuelReportDay[];
  totals: FuelReportTotals;
}

export interface FuelReport {
  current: FuelReportWindow;
  previous: FuelReportWindow;
  /** The brands counted as in network, so the page can name them rather than say "the network". */
  inNetworkBrands: string[];
  /** Places fuelled in the CURRENT range, busiest first. A null station is unresolved fills in that state. */
  sites: FuelReportSite[];
}

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const str = (v: unknown): string | null => (v == null ? null : String(v));
// A non-empty list or null: an empty filter means "no filter", never "match nothing".
const listOrNull = <T>(xs: readonly T[]): T[] | null => (xs.length > 0 ? [...xs] : null);

function toDay(r: Record<string, unknown>): FuelReportDay {
  return {
    day: String(r.day).slice(0, 10),
    network: r.network as FuelNetwork,
    tank: r.tank === "reefer" ? "reefer" : "tractor",
    fills: n(r.fills),
    gallons: n(r.gallons),
    spend: n(r.spend),
    retailFills: n(r.retail_fills),
    retailGallons: n(r.retail_gallons),
    retailSpend: n(r.retail_spend),
    retail: n(r.retail),
    contractFills: n(r.contract_fills),
    contractGallons: n(r.contract_gallons),
    contractSpend: n(r.contract_spend),
    contract: n(r.contract),
  };
}

async function readWindow(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  brands: string[],
  f: FuelReportFilterArgs,
): Promise<FuelReportWindow> {
  // Paged: a year is up to 366 days × 3 networks × 2 tanks, past PostgREST's 1,000-row cap.
  const rows = await fetchAllPaged<Record<string, unknown>>((a, b) =>
    admin
      .rpc("fuel_report_days", {
        p_from: from,
        p_to: to,
        p_in_network_brands: brands,
        p_vehicles: listOrNull(f.vehicleIds),
        p_states: listOrNull(f.states),
        p_sites: listOrNull(f.siteIds),
        p_network: listOrNull(f.networks),
        p_org: orgId,
      })
      .range(a, b),
  );
  const days = rows.map(toDay);
  return { from, to, days, totals: fuelReportTotals(days) };
}

export async function readFuelReport(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  filters: FuelReportFilterArgs,
): Promise<FuelReport> {
  const brands = [...(await readFuelPolicy(admin, orgId)).preferredBrands];
  const prev = previousFuelReportRange(from, to);
  // Two calls rather than one over both ranges: each stays inside the statement timeout on its own
  // (838 ms for 90 days, measured 2026-10-02) and they run side by side.
  const [current, previous, siteRows] = await Promise.all([
    readWindow(admin, orgId, from, to, brands, filters),
    readWindow(admin, orgId, prev.from, prev.to, brands, filters),
    fetchAllPaged<Record<string, unknown>>((a, b) =>
      admin.rpc("fuel_report_sites", { p_from: from, p_to: to, p_org: orgId }).range(a, b),
    ),
  ]);
  return {
    current,
    previous,
    inNetworkBrands: brands,
    sites: siteRows.map((r) => ({
      stationId: str(r.station_id),
      brand: str(r.brand),
      site: str(r.site),
      city: str(r.city),
      state: str(r.state),
      fills: n(r.fills),
      gallons: n(r.gallons),
    })),
  };
}
