/**
 * What a gallon of idled diesel costs, and where that price came from (Q9,
 * `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2).
 *
 * ── WHY THE RULE IS HERE AND THE READS ARE NOT ──────────────────────────────────────────────────
 * §7.2b's seam: a FACT moves to SQL, a RULE stays in TypeScript. "Prefer the day's posted truck-stop
 * median, fall back to the org's configured price, fall back to $4.00" is a rule — a product
 * judgement about which imperfect number is least wrong — so it lives in one pure function that the
 * server resolver and the browser can both call, and that can be tested without a database.
 *
 * It existed twice before this file, in two shapes that disagreed. `useIdleCostBasis.ts` did all
 * three tiers for the Idling page and the Dashboard; `fuelIdleVerdict.ts`'s `readCostBasis` did the
 * bottom two for the fuel-spend REPORT, so the same fleet's unpriced idle was charged at $4.00 in a
 * document and at the truck-stop median on screen. Measured against production 2026-09-21: the
 * configured price is $4.000/gal, the 14-day truck-stop median is $5.873/gal, and what the fleet
 * actually paid those days (`fuel_price_days.actual_price_per_gal`) was $5.79–$6.22. The tier order
 * below is not a preference — it is the one that lands nearest the fact.
 */
import type { IdleCostBasisInput } from "./idleBreakdown.js";

/** Which tier of the rule below answered. Travels on the wire because the Idling page DISPLAYS it. */
export type IdlePriceSource = "truck_stops" | "settings" | "default";

export interface IdleCostBasis extends IdleCostBasisInput {
  priceSource: IdlePriceSource;
}

/**
 * The last-resort pair, when an org has configured neither.
 *
 * 0.8 gal/h is main-engine Class-8 idle; $4.00/gal is the column default 0044 gave `idle_settings`.
 * Named once here because three files restated them and a fourth was about to.
 */
export const IDLE_COST_BASIS_DEFAULTS: IdleCostBasisInput = { idleGalPerHour: 0.8, fuelPricePerGal: 4.0 };

/** How far back the truck-stop median looks. Long enough to survive a quiet weekend of ingests. */
export const IDLE_PRICE_LOOKBACK_DAYS = 14;

/**
 * The median of a sample of prices, or null when there is nothing to take a median of.
 *
 * A MEDIAN and not a mean, because the posted board mixes brands, states and both cash and credit
 * rows: one $9 outlier from a California station would drag a mean the whole fleet is priced with,
 * and the middle of the sample is what a truck in the middle of the network would actually pay.
 */
export function medianOf(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2;
}

export interface IdleCostBasisSources {
  /** `idle_settings.idle_gal_per_hour`, or null when the org has no settings row. */
  settingsGalPerHour: number | null;
  /** `idle_settings.fuel_price_per_gal`, or null when the org has no settings row. */
  settingsPricePerGal: number | null;
  /** Median of the org's recent posted truck-stop diesel prices, or null when there were none. */
  truckStopMedian: number | null;
}

/**
 * Choose the basis. Pure, so the same three tiers answer a page, an endpoint and a PDF.
 *
 * ⚠ A stored value of 0 (or anything non-positive) is treated as NOT CONFIGURED rather than
 * honoured. `idle_settings` is `not null` with defaults and carries no positivity check (0044), so a
 * zero can be saved — and a zero burn rate silently prices a fleet's entire idle at $0, which reads
 * as "no waste" rather than as the misconfiguration it is. The old browser path would have shown
 * that $0; the old server path would not, because it used `Number(x) || default`. This keeps the
 * safer of the two behaviours and says so.
 */
export function pickIdleCostBasis(sources: IdleCostBasisSources): IdleCostBasis {
  const idleGalPerHour = positive(sources.settingsGalPerHour) ?? IDLE_COST_BASIS_DEFAULTS.idleGalPerHour;

  const median = positive(sources.truckStopMedian);
  if (median != null) {
    // Three decimals is the precision `fuel_prices` itself carries; rounding here rather than at the
    // display end keeps one number in the contract, the tests and the screen.
    return { idleGalPerHour, fuelPricePerGal: Math.round(median * 1000) / 1000, priceSource: "truck_stops" };
  }

  const configured = positive(sources.settingsPricePerGal);
  if (configured != null) return { idleGalPerHour, fuelPricePerGal: configured, priceSource: "settings" };

  return { idleGalPerHour, fuelPricePerGal: IDLE_COST_BASIS_DEFAULTS.fuelPricePerGal, priceSource: "default" };
}

function positive(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
