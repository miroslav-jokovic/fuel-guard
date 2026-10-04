/**
 * What the Idling page says beside each fleet total — how it was priced and how far the data reaches. Split
 * from `idleBreakdown.ts`, which calls these once each, to keep that file inside the 500-line budget.
 */
import type { AvoidableDaySeconds } from "./idleAvoidable.js";
import type { IdleBreakdownRollupRow } from "./idleBreakdown.js";

/**
 * How one fleet total was priced, so the page can say it beside the dollars (design verdict 2026-10-03, move
 * 4: "show coverage beside each estimate"). Each day is charged at that day's diesel price where one exists
 * (`avoidableCostByDay`); a day with none falls back to the cost basis. Counted in CALENDAR days over the
 * trucks inside that total, a day once however many trucks idled on it, because "3 of 30 days had no price"
 * is the sentence a reader can check against a calendar.
 */
export interface IdleTotalPricing {
  /** Dollars ÷ gallons over the total; null when it priced no gallons. */
  blendedPricePerGal: number | null;
  /** Days that added to the total and had a day price. */
  pricedDays: number;
  /** Days that added to the total with no day price, charged at the cost basis instead. */
  unpricedDays: number;
}

/** One truck's share of a total: its dated seconds, and the gallons and dollars it added. */
export interface IdlePricedPart {
  days: readonly AvoidableDaySeconds[];
  gallons: number;
  usd: number;
}

/** Folds the dated costs of the trucks inside one total into its `IdleTotalPricing`. */
export function idleTotalPricing(
  parts: readonly IdlePricedPart[],
  side: "avoidableIdleSec" | "reducibleIdleSec",
  dayPrices: ReadonlyMap<string, number>,
): IdleTotalPricing {
  const priced = new Set<string>();
  const unpriced = new Set<string>();
  let gallons = 0, usd = 0;
  for (const p of parts) {
    gallons += p.gallons;
    usd += p.usd;
    for (const d of p.days) {
      if (!(d[side] > 0)) continue;
      const price = dayPrices.get(d.day);
      (price != null && Number.isFinite(price) && price > 0 ? priced : unpriced).add(d.day);
    }
  }
  return {
    blendedPricePerGal: gallons > 0 ? Math.round((usd / gallons) * 1000) / 1000 : null,
    pricedDays: priced.size,
    unpricedDays: unpriced.size,
  };
}


/**
 * The latest day any LISTED truck has engine-state coverage for — how far the figures reach. Only trucks
 * that made the list (a vehicle the range observed nothing for is not one), and only days with coverage: a
 * rollup row of zeros is a day the collector wrote, not a day anything was seen. Null with none.
 */
export function idleThroughDay(rows: readonly IdleBreakdownRollupRow[], listed: ReadonlySet<string>): string | null {
  let through: string | null = null;
  for (const row of rows) {
    if (listed.has(row.vehicle_id) && row.coverage_sec > 0 && (through == null || row.day > through)) through = row.day;
  }
  return through;
}
