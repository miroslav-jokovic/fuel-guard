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
import { addDays, windowDays } from "./spendWindow.js";
import type { FleetMpgPeriod } from "./fleetEfficiency.js";

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

// ── the verdicts over those sums ─────────────────────────────────────────────────────────────────

/**
 * What one slice of the report says, derived from the sums alone. Every ratio is null rather than 0
 * when its denominator is empty: "no quote reached these fills" must never read as "billed at quote".
 */
export interface FuelReportSummary {
  fills: number;
  gallons: number;
  spend: number;
  /** spend ÷ gallons — "Avg price / gal" (§5). */
  pricePerGal: number | null;
  /**
   * Posted price − paid, over the fills that HAD a posted price. Null when none did, which is every
   * fill off the network (Pilot's report prices only its own sites).
   */
  discount: number | null;
  discountPerGal: number | null;
  /** Share of gallons the discount figures cover. */
  discountCoverage: number | null;
  /**
   * Paid − Pilot's "Your Price", over the quoted fills — "Paid vs Pilot quote" (§5). Positive is money
   * billed above the contract. A NET figure: one overbilled fill and one underbilled fill cancel here,
   * so the per-fill list a claim is made from stays `analyzeContractCapture`'s.
   */
  paidVsQuote: number | null;
  paidVsQuotePerGal: number | null;
  quoteCoverage: number | null;
}

export interface FuelReportTotals {
  /** Tractor fuel: what cost-per-mile and MPG are about (D-FSV4). */
  tractor: FuelReportSummary;
  /** Reefer fuel, reported beside the tractor figures and never inside them. */
  reefer: FuelReportSummary;
  /** Tractor fuel by network side, `in` / `out` / `unknown` station. */
  byNetwork: Record<FuelNetwork, FuelReportSummary>;
}

function summarise(days: readonly FuelReportDay[]): FuelReportSummary {
  let fills = 0, gallons = 0, spend = 0;
  let retailGallons = 0, retailSpend = 0, retail = 0, retailFills = 0;
  let contractGallons = 0, contractSpend = 0, contract = 0, contractFills = 0;
  for (const d of days) {
    fills += d.fills; gallons += d.gallons; spend += d.spend;
    retailFills += d.retailFills; retailGallons += d.retailGallons; retailSpend += d.retailSpend; retail += d.retail;
    contractFills += d.contractFills; contractGallons += d.contractGallons; contractSpend += d.contractSpend; contract += d.contract;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  const discount = retailFills > 0 ? retail - retailSpend : null;
  const overQuote = contractFills > 0 ? contractSpend - contract : null;
  return {
    fills,
    gallons: Math.round(gallons * 1000) / 1000,
    spend: r2(spend),
    pricePerGal: gallons > 0 ? r4(spend / gallons) : null,
    discount: discount == null ? null : r2(discount),
    discountPerGal: discount != null && retailGallons > 0 ? r4(discount / retailGallons) : null,
    discountCoverage: gallons > 0 ? r4(retailGallons / gallons) : null,
    paidVsQuote: overQuote == null ? null : r2(overQuote),
    paidVsQuotePerGal: overQuote != null && contractGallons > 0 ? r4(overQuote / contractGallons) : null,
    quoteCoverage: gallons > 0 ? r4(contractGallons / gallons) : null,
  };
}

export function fuelReportTotals(days: readonly FuelReportDay[]): FuelReportTotals {
  const tractor = days.filter((d) => d.tank === "tractor");
  return {
    tractor: summarise(tractor),
    reefer: summarise(days.filter((d) => d.tank === "reefer")),
    byNetwork: {
      in: summarise(tractor.filter((d) => d.network === "in")),
      out: summarise(tractor.filter((d) => d.network === "out")),
      unknown: summarise(tractor.filter((d) => d.network === "unknown")),
    },
  };
}

/**
 * The range a trend card compares against (D-FSV3): the same number of days, ending the day before
 * the picked range starts. 09/01–09/30 (30 days) → 08/02–08/31; never "the previous calendar month",
 * which is 31 days here and would tilt every comparison by a day's fuel.
 */
export function previousFuelReportRange(from: string, to: string): { from: string; to: string } {
  return { from: addDays(from, -windowDays(from, to)), to: addDays(from, -1) };
}

// ── the wire shape of `GET /api/fueling/report` ────────────────────────────────────────────────
// Here rather than in the API service for the reason `FleetMpgPeriod` is: the page reads it, and a
// contract the API writes and the web reads has one home (CLAUDE.md, `lint:shared-contracts`).

export interface FuelReportSite {
  stationId: string | null;
  brand: string | null;
  site: string | null;
  city: string | null;
  state: string | null;
  fills: number;
  gallons: number;
}

/**
 * Miles, MPG and cost per mile for one range (FS2, D-FSV4). `mpg` is the whole `getFleetMpg` answer,
 * refusal and coverage included, so the page can say why a figure is missing rather than print a dash.
 */
export interface FuelReportEfficiency {
  mpg: FleetMpgPeriod;
  /** `fuelCostPerMile(tractor price/gal, mpg)`; null whenever `mpg.mpg` is. */
  costPerMile: number | null;
}

export interface FuelReportWindow {
  from: string;
  to: string;
  days: FuelReportDay[];
  totals: FuelReportTotals;
  /** Null under a state, location or network filter — see `FUEL_REPORT_TRUCK_FIGURES_NOTE`. */
  efficiency: FuelReportEfficiency | null;
}

/**
 * One day's trailing-7-day MPG (D-FSV5): the fleet MPG over that day and the six before it. D-MPG6
 * stands — one day's purchases do not measure one day's burn — so a day row never carries its own MPG.
 */
export interface FuelReportTrailingMpg {
  day: string;
  /** Null with `reason` when withheld, including a week the fuel roll-up hasn't reached the end of. */
  mpg: number | null;
  measuredShare: number | null;
  reason: string | null;
}

export interface FuelReport {
  current: FuelReportWindow;
  previous: FuelReportWindow;
  /** One row per day of the CURRENT range, oldest first; null whenever `current.efficiency` is. */
  trailingMpg: FuelReportTrailingMpg[] | null;
  /** The brands counted as in network, so the page can name them rather than say "the network". */
  inNetworkBrands: string[];
  /** Places fuelled in the CURRENT range, busiest first. A null station is unresolved fills in that state. */
  sites: FuelReportSite[];
}

/** How many days a trailing MPG reaches back, the day itself included (D-FSV5). */
export const TRAILING_MPG_DAYS = 7;

/**
 * What the report says instead of miles, MPG and cost per mile under a state, location or network
 * filter (D-FSV5, widened in FS2 to the two figures built on MPG). Those filters select FILLS, and a
 * truck's odometer distance has no honest share at one station: the truck drove the miles whichever
 * pump it stopped at.
 */
export const FUEL_REPORT_TRUCK_FIGURES_NOTE =
  "Miles, MPG and cost per mile are truck figures, so they don't apply to a state, location or network filter.";
