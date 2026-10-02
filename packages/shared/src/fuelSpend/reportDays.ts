/**
 * The Fuel Costs report's daily measurements (FS1, D-FSV2/D-FSV6 of
 * `docs/plans/fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md`).
 *
 * `fuel_report_days()` (migration 0405) SUMS — per business day, network and tank — and returns the
 * quantities. Every judgement about them (average price, discount, paid-vs-quote, the trend against the
 * previous range) is made in TypeScript from those sums, the D-AG1 split: a threshold or a ratio written
 * into SQL is a second copy no unit test reaches. This file holds two things:
 *
 *   1. `fuelNetworkOf` — THE definition of in / out of network / unknown station. One place.
 *   2. `filterFuelReportLines` + `foldFuelReportDays` — the executable spec of what the SQL must
 *      compute. `supabase/tests/fuel-report-days.test.mjs` imports these from `dist` and asserts the
 *      function against them row for row, so SQL and spec cannot drift apart silently.
 */

/** `in` = a brand on the carrier's network; `out` = a known station that isn't; `unknown` = no station. */
export type FuelNetwork = "in" | "out" | "unknown";

export const FUEL_NETWORKS: readonly FuelNetwork[] = ["in", "out", "unknown"];

/**
 * Which side of the network a fill sits on.
 *
 * ── THE BRAND LIST IS PASSED IN, NEVER WRITTEN HERE ─────────────────────────────────────────────
 * R11 (owner, 2026-10-01): out of network is anything not Pilot / Flying J, ONE9 included. That is
 * already the carrier's `route_fuel_settings.preferred_brands` (`{pilot, flying_j}` in production,
 * measured 2026-10-02), with `DEFAULT_FUEL_POLICY.preferredBrands` as the fallback — the list the
 * planner routes to and the policy report measures against. A third copy here would be the D-FSV2
 * failure: the day the carrier adds a brand, the report and the planner would disagree about where
 * the trucks were sent.
 *
 * ── A NULL BRAND IS "NO STATION", NOT "OUT" ─────────────────────────────────────────────────────
 * `fuel_stations.brand` is NOT NULL (0058), so a fill with no brand is a fill whose station was never
 * resolved — 20 tractor fills, $13,737.52 in September. Folding those into `out` would charge an
 * unknown to the drivers; folding them into `in` would hide them. D-FSV2 gives them their own bucket.
 * (`policyPredicates.isOffNetwork` counts them as off-network; that report asks a different question —
 * "did we fuel where the policy says?" — and an unresolved fill can't prove it did.)
 */
export function fuelNetworkOf(brand: string | null, inNetworkBrands: readonly string[]): FuelNetwork {
  if (brand == null) return "unknown";
  return inNetworkBrands.includes(brand) ? "in" : "out";
}

export type FuelReportTank = "tractor" | "reefer";

/** One fill, as `fuel_spend_lines()` returns it — the input both the SQL and this spec sum. */
export interface FuelReportLine {
  tranDate: string;
  brand: string | null;
  state: string | null;
  stationId: string | null;
  tank: FuelReportTank;
  gallons: number;
  netAmount: number | null;
  retailAmount: number | null;
  contractAmount: number | null;
}

/** One `fuel_report_days()` row. Every money and gallon figure is a SUM; nothing here is a ratio. */
export interface FuelReportDay {
  day: string;
  network: FuelNetwork;
  tank: FuelReportTank;
  fills: number;
  gallons: number;
  spend: number;
  /**
   * The same three sums restricted to fills that HAD a posted price. A discount is retail − spend over
   * these alone: dividing a partial retail sum by every gallon is the bug `SpendTotals.retailGallons`
   * documents (it printed −$4.779/gal of "discount" on the off-network tab, where nothing is quoted).
   */
  retailFills: number;
  retailGallons: number;
  retailSpend: number;
  retail: number;
  /** Likewise for the Pilot "Your Price" contract quote (D-FC3, 0247). */
  contractFills: number;
  contractGallons: number;
  contractSpend: number;
  contract: number;
}

export interface FuelReportFilters {
  /** Two-letter states; null = all. Matched against the FILL's state, which unknown-station fills carry too. */
  states: readonly string[] | null;
  /** `fuel_stations.id`; null = all. An unknown-station fill has no id and so never matches a site filter. */
  stationIds: readonly string[] | null;
  networks: readonly FuelNetwork[] | null;
}

/** The filters `fuel_report_days` applies on top of `fuel_spend_lines` (the truck filter is passed through to it). */
export function filterFuelReportLines(
  lines: readonly FuelReportLine[],
  f: FuelReportFilters,
  inNetworkBrands: readonly string[],
): FuelReportLine[] {
  return lines.filter(
    (l) =>
      (f.states == null || (l.state != null && f.states.includes(l.state))) &&
      (f.stationIds == null || (l.stationId != null && f.stationIds.includes(l.stationId))) &&
      (f.networks == null || f.networks.includes(fuelNetworkOf(l.brand, inNetworkBrands))),
  );
}

/** Sum fills per (day, network, tank), ordered the way the SQL orders them. */
export function foldFuelReportDays(lines: readonly FuelReportLine[], inNetworkBrands: readonly string[]): FuelReportDay[] {
  const out = new Map<string, FuelReportDay>();
  for (const l of lines) {
    const network = fuelNetworkOf(l.brand, inNetworkBrands);
    const key = `${l.tranDate}|${network}|${l.tank}`;
    let d = out.get(key);
    if (!d) {
      d = {
        day: l.tranDate, network, tank: l.tank, fills: 0, gallons: 0, spend: 0,
        retailFills: 0, retailGallons: 0, retailSpend: 0, retail: 0,
        contractFills: 0, contractGallons: 0, contractSpend: 0, contract: 0,
      };
      out.set(key, d);
    }
    // SQL `sum()` skips a null; so does this. No production fill has a null cost (0 in September).
    const net = l.netAmount ?? 0;
    d.fills += 1;
    d.gallons += l.gallons;
    d.spend += net;
    if (l.retailAmount != null) {
      d.retailFills += 1;
      d.retailGallons += l.gallons;
      d.retailSpend += net;
      d.retail += l.retailAmount;
    }
    if (l.contractAmount != null) {
      d.contractFills += 1;
      d.contractGallons += l.gallons;
      d.contractSpend += net;
      d.contract += l.contractAmount;
    }
  }
  const order = (d: FuelReportDay) => `${d.day}|${FUEL_NETWORKS.indexOf(d.network)}|${d.tank}`;
  return [...out.values()].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}
