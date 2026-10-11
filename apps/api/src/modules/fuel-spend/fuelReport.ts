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
 *
 * MILES, MPG AND COST PER MILE (FS2, D-FSV4/D-FSV5) are not SQL's: they are `getFleetMpgPeriods`
 * (D-MPG1's one definition) over the same trucks, composed here so the page makes one request. Asked
 * for the range, the previous range and the trailing week ending on each day of the range, in ONE
 * call, so the odometer staging is read once however many days there are. Under a state, location or
 * network filter they are null and the page shows `FUEL_REPORT_TRUCK_FIGURES_NOTE` instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  fuelCostPerMile,
  fuelReportTotals,
  previousFuelReportRange,
  TRAILING_MPG_DAYS,
  type FuelNetwork,
  type FuelReport,
  type FuelReportDay,
  type FuelReportTrailingMpg,
  type FuelReportWindow,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { readFuelPolicy } from "./fuelSpendLines.js";
import { getFleetMpgPeriods, type FleetMpgResult } from "./fleetMpg.js";

export interface FuelReportFilterArgs {
  vehicleIds: string[];
  states: string[];
  siteIds: string[];
  networks: FuelNetwork[];
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
): Promise<Omit<FuelReportWindow, "efficiency">> {
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

/** Every day of `[from, to]`, oldest first. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * One day's row from its trailing-week period. A PARTIAL period is withheld too, not only a refused
 * one: clamped to the roll-up's last day, it measured an earlier week than the day it would be printed
 * against, and the label would be wrong even though the figure is not.
 */
function trailingRow(day: string, p: FleetMpgResult): FuelReportTrailingMpg {
  if (p.partial && p.mpg != null) {
    return {
      day,
      mpg: null,
      measuredShare: p.measuredShare,
      reason: `The fuel roll-up reaches ${p.fuelThrough}, so this day's week isn't complete yet.`,
    };
  }
  return { day, mpg: p.mpg, measuredShare: p.measuredShare, reason: p.reason };
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
  // Truck figures only for a truck question (D-FSV5): a station-side filter selects fills, not trucks.
  const truckQuestion = filters.states.length === 0 && filters.siteIds.length === 0 && filters.networks.length === 0;
  const days = eachDay(from, to);
  const periods = truckQuestion
    ? [{ from, to }, prev, ...days.map((d) => ({ from: addDays(d, -(TRAILING_MPG_DAYS - 1)), to: d }))]
    : [];
  // Two calls rather than one over both ranges: each stays inside the statement timeout on its own
  // (838 ms for 90 days, measured 2026-10-02) and they run side by side.
  const [current, previous, siteRows, mpgs] = await Promise.all([
    readWindow(admin, orgId, from, to, brands, filters),
    readWindow(admin, orgId, prev.from, prev.to, brands, filters),
    fetchAllPaged<Record<string, unknown>>((a, b) =>
      admin.rpc("fuel_report_sites", { p_from: from, p_to: to, p_org: orgId }).range(a, b),
    ),
    getFleetMpgPeriods(admin, orgId, periods, filters.vehicleIds.length > 0 ? filters.vehicleIds : null),
  ]);
  const efficiency = (w: Omit<FuelReportWindow, "efficiency">, mpg: FleetMpgResult | undefined) =>
    mpg == null ? null : { mpg, costPerMile: fuelCostPerMile(w.totals.tractor.pricePerGal, mpg) };
  return {
    current: { ...current, efficiency: efficiency(current, mpgs[0]) },
    previous: { ...previous, efficiency: efficiency(previous, mpgs[1]) },
    trailingMpg: truckQuestion ? days.map((d, i) => trailingRow(d, mpgs[i + 2]!)) : null,
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
