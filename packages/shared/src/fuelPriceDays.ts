/**
 * Daily diesel price resolution (pure) — the price the idle cost model charges for a given day.
 *
 * Principle, same as the idle verdict: prefer measured fact, fall back explicitly, and record which. The
 * fleet's own purchases are the fact — the gallon burned while idling was bought at the price the fleet
 * actually paid, not at a posted rack rate. Posted prices are a market reference and only stand in when
 * there were no purchases at all that day.
 */

export type FuelPriceSource = "actual" | "posted" | "carried_forward" | "settings" | "default";

/** Class-8 diesel fallback of last resort — only reached when an org has no purchases, no posted prices
 *  and no configured rate. Deliberately conservative; a wrong high default inflates every idle dollar. */
export const DEFAULT_FUEL_PRICE_PER_GAL = 4.0;

export interface FuelFill {
  /** Calendar day (YYYY-MM-DD) on the ORG's operating clock — the same boundary idle days are cut on. */
  day: string;
  pricePerGal: number;
  /** Gallons on the fill. Fills without a usable quantity still count toward the day, weighted as one. */
  gallons: number;
}

export interface PostedPriceDay {
  day: string;
  pricePerGal: number;
  sampleCount: number;
}

export interface FuelPriceDay {
  day: string;
  actualPricePerGal: number | null;
  actualGallons: number;
  actualFillCount: number;
  postedPricePerGal: number | null;
  postedSampleCount: number;
  effectivePricePerGal: number;
  priceSource: FuelPriceSource;
  /** Only set when carried forward — the day the price came from, so staleness stays visible. */
  carriedFromDay: string | null;
}

export interface FuelPriceDayOpts {
  /** The org's configured fallback rate, when it has one. */
  settingsPricePerGal?: number | null;
  /**
   * How many days a price may be carried forward before the model stops trusting it and drops to the
   * configured/default rate. A fleet that fuels daily never reaches this; a fleet on a two-week shutdown
   * should not have week-old prices presented as current. Default 7.
   */
  maxCarryForwardDays?: number;
}

const DAY_MS = 86_400_000;
const isFinitePositive = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 0;

/** Inclusive list of calendar days from `fromDay` to `toDay`, both YYYY-MM-DD. */
export function calendarDays(fromDay: string, toDay: string): string[] {
  const start = Date.parse(`${fromDay}T00:00:00Z`);
  const end = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

/**
 * Build one price row per day across `[fromDay, toDay]`.
 *
 * Gallon-weighted, not a plain mean of prices: a 200-gallon fill and a 20-gallon top-up are not equal
 * evidence of what the fleet paid that day. Fills whose quantity is missing still count, weighted as one,
 * rather than being dropped — a priced fill is evidence even when the volume did not come through.
 *
 * `priorPrice` seeds the carry-forward chain so a window that opens on a no-purchase day can still resolve
 * from the last known price before it, instead of falling to the default.
 */
export function buildFuelPriceDays(
  input: {
    fromDay: string;
    toDay: string;
    fills: readonly FuelFill[];
    posted?: readonly PostedPriceDay[];
    priorPrice?: { day: string; pricePerGal: number } | null;
  },
  opts: FuelPriceDayOpts = {},
): FuelPriceDay[] {
  const maxCarry = Math.max(0, opts.maxCarryForwardDays ?? 7);
  const settingsPrice = isFinitePositive(opts.settingsPricePerGal)
    ? opts.settingsPricePerGal
    : null;

  const byDay = new Map<string, { weighted: number; gallons: number; count: number }>();
  for (const fill of input.fills) {
    if (!isFinitePositive(fill.pricePerGal)) continue;
    // A missing/zero quantity still evidences the price; weight it as a single gallon rather than drop it.
    const weight = Number.isFinite(fill.gallons) && fill.gallons > 0 ? fill.gallons : 1;
    const acc = byDay.get(fill.day) ?? { weighted: 0, gallons: 0, count: 0 };
    acc.weighted += fill.pricePerGal * weight;
    acc.gallons += weight;
    acc.count += 1;
    byDay.set(fill.day, acc);
  }
  const postedByDay = new Map<string, PostedPriceDay>();
  for (const p of input.posted ?? []) if (isFinitePositive(p.pricePerGal)) postedByDay.set(p.day, p);

  let lastKnown: { day: string; pricePerGal: number } | null =
    input.priorPrice && isFinitePositive(input.priorPrice.pricePerGal) ? input.priorPrice : null;

  const rows: FuelPriceDay[] = [];
  for (const day of calendarDays(input.fromDay, input.toDay)) {
    const fills = byDay.get(day);
    const actual = fills && fills.gallons > 0 ? fills.weighted / fills.gallons : null;
    const posted = postedByDay.get(day) ?? null;

    let effective: number;
    let source: FuelPriceSource;
    let carriedFrom: string | null = null;

    if (isFinitePositive(actual)) {
      effective = actual;
      source = "actual";
      lastKnown = { day, pricePerGal: actual };
    } else if (posted != null) {
      effective = posted.pricePerGal;
      source = "posted";
      // A posted quote is a market observation, not this fleet's cost — it does not become the price a
      // later no-data day inherits.
    } else if (lastKnown != null && daysBetween(lastKnown.day, day) <= maxCarry) {
      effective = lastKnown.pricePerGal;
      source = "carried_forward";
      carriedFrom = lastKnown.day;
    } else if (settingsPrice != null) {
      effective = settingsPrice;
      source = "settings";
    } else {
      effective = DEFAULT_FUEL_PRICE_PER_GAL;
      source = "default";
    }

    rows.push({
      day,
      actualPricePerGal: isFinitePositive(actual) ? round4(actual) : null,
      actualGallons: fills ? round3(fills.gallons) : 0,
      actualFillCount: fills?.count ?? 0,
      postedPricePerGal: posted ? round4(posted.pricePerGal) : null,
      postedSampleCount: posted?.sampleCount ?? 0,
      effectivePricePerGal: round4(effective),
      priceSource: source,
      carriedFromDay: carriedFrom,
    });
  }
  return rows;
}

function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / DAY_MS);
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

/** Day → effective price, for the cost model to look up per rollup day. */
export function fuelPriceByDay(rows: readonly FuelPriceDay[]): Map<string, number> {
  return new Map(rows.map((r) => [r.day, r.effectivePricePerGal]));
}
