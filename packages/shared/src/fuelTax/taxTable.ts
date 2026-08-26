/**
 * What a gallon of diesel carries in state tax where it was bought — F10, and the reason D-FX11 held
 * F11 and F13 back until it existed.
 *
 * ── THE SCOPE, AND EVERY SURFACE MUST SAY IT IN THESE WORDS ──────────────────────────────────────
 * This is the tax PAID AT THE PUMP, per PURCHASE STATE. It is not net of IFTA. Under IFTA a carrier
 * owes each jurisdiction its rate on the miles BURNED there and is credited for the tax it paid at
 * the pump, so the tax component of a fuel bill is mostly a wash against a liability the carrier owes
 * wherever it bought the fuel. That makes the purchase-state tax the wrong number to call a saving —
 * and exactly the right number to SUBTRACT before comparing two stations, because what is left is the
 * price of the fuel itself, which is the only part a buying decision can move.
 *
 * Q-FX4 measured why it stops here: nothing in this product pairs miles with a jurisdiction. Trucks
 * fuel every 57.8 hours and cross a state line on 90.1% of consecutive-fill pairs, so interpolating
 * burn states between fuel stops would invent precision across ~1,500 miles and several jurisdictions
 * a segment. The carrier has moved off McLeod's IFTA miles to Samsara-derived mileage, which is not
 * wired up yet. `landedCost.ts` therefore takes the apportionment as a PARAMETER defaulting to
 * "burned where it was bought", so real jurisdiction miles are a new argument at one call site rather
 * than a rewrite.
 *
 * ── WHY THE IFTA MATRIX AND NOT A PRICE-DECOMPOSITION VENDOR ─────────────────────────────────────
 * IFTA, Inc. publishes the rate every member jurisdiction reports for itself, quarterly, with the
 * effective quarter stated and a finality date. It is the same table the carrier's own IFTA return is
 * computed from, it is free, and it is versioned by construction. `scripts/fetch-ifta-rates.mjs`
 * mints `rates2026.ts` from it and refuses to write when consecutive quarters disagree.
 *
 * ── THREE THINGS THIS TABLE KEEPS APART THAT LOOK ALIKE ──────────────────────────────────────────
 *   1. A rate of `null` — unknown, or not levied per gallon. NEVER read as zero (D-FX7). A
 *      jurisdiction with no row, or a date no captured quarter covers, answers "I cannot tell you".
 *   2. Oregon — taxes heavy trucks by the MILE (the weight-mile tax) and its retailers may sell
 *      untaxed diesel to a truck that pays it, which is why the matrix carries no Oregon diesel rate
 *      at all. Oregon fuel is not cheap-because-untaxed; the tax arrives on a different bill. Stored
 *      as `basis: "weight_mile"` so a "buy here instead" recommendation cannot mistake the missing
 *      per-gallon tax for a discount. Measured on production: 1.05% of the default window's gallons.
 *   3. A surcharge — Kentucky and Virginia levy one, and it is NOT collected at the pump. It is paid
 *      on the quarterly return over taxable (burned) gallons, with no credit for tax-paid gallons.
 *      It is carried here for the day burn states are known, and is excluded from every pump figure.
 */

import { DIESEL_TAX_QUARTERS } from "./rates2026.js";

/** One quarter of the IFTA matrix, exactly as minted. `rates2026.ts` is the only producer. */
export interface DieselTaxQuarter {
  /** The IFTA quarter id, e.g. `"3Q2026"`. Recorded on any figure derived from it. */
  version: string;
  /** Inclusive ISO date bounds of the quarter this matrix governs. */
  effectiveFrom: string;
  effectiveTo: string;
  /**
   * IFTA marks a quarter's matrix provisional until a stated date, because jurisdictions may still
   * revise. A figure computed from a non-final quarter is a weaker claim and says so, on the same
   * argument as `packages/hazmat-data`'s `provisional` flag.
   */
  final: boolean;
  notFinalUntil: string | null;
  /** When this repository fetched the page — provenance, not the rate's effective date. */
  capturedOn: string;
  /** Jurisdiction code → U.S. dollars of tax per gallon at the pump. `null` is unknown, not zero. */
  pumpPerGal: Readonly<Record<string, number | null>>;
  /** Jurisdiction code → the return-billed surcharge. Never added to a pump figure. */
  returnSurchargePerGal: Readonly<Record<string, number>>;
}

/** How a jurisdiction levies its diesel tax — the difference between "no tax" and "a different bill". */
export type DieselTaxBasis = "per_gallon" | "weight_mile";

export interface DieselTaxRate {
  /** Uppercase two-letter jurisdiction code. */
  state: string;
  /**
   * Dollars of state tax in a gallon's pump price. Zero ONLY where the jurisdiction genuinely levies
   * nothing per gallon — read `basis` before treating a zero as cheap fuel.
   */
  pumpPerGal: number;
  basis: DieselTaxBasis;
  /** The surcharge owed on the return over gallons BURNED here. Not in `pumpPerGal`. */
  returnSurchargePerGal: number;
  /** The quarter this came from, and whether IFTA has finalised it. */
  version: string;
  final: boolean;
}

/**
 * The jurisdictions that do not levy a per-gallon diesel tax at the pump, and why.
 *
 * Kept as an explicit list rather than inferred from a missing rate, because "the matrix has no row"
 * and "this jurisdiction taxes by the mile instead" are different facts and only the second one is
 * safe to price at zero. A new jurisdiction that disappears from the matrix therefore reads as
 * unknown until somebody decides which of the two it is.
 */
const WEIGHT_MILE_STATES: Readonly<Record<string, string>> = {
  OR: "Oregon taxes heavy trucks by the mile and its retailers may sell them untaxed diesel, so the tax arrives on the weight-mile return rather than in the pump price.",
};

/** Why a jurisdiction has no per-gallon pump tax, or null when it does. */
export function weightMileReason(state: string): string | null {
  return WEIGHT_MILE_STATES[state.toUpperCase()] ?? null;
}

/** The quarter governing an ISO date, or null when no captured quarter covers it. */
export function dieselTaxQuarterFor(date: string): DieselTaxQuarter | null {
  // ISO dates compare correctly as strings, which is why every date in this codebase is one. The
  // bounds are inclusive: 2026-06-30 is 2Q, 2026-07-01 is 3Q, and a rate is never carried across a
  // quarter boundary — `fuel_prices` carries a QUOTE forward one day because a missing daily report
  // is an operational gap, but a tax rate that has expired has not gone missing, it has changed.
  return DIESEL_TAX_QUARTERS.find((q) => date >= q.effectiveFrom && date <= q.effectiveTo) ?? null;
}

/**
 * The diesel tax a gallon bought in `state` on `date` carried at the pump — or null, which means
 * exactly "we cannot tell you" and never "no tax".
 *
 * Null on: no state, no date, a date outside every captured quarter (the table stops where the
 * capture stopped and does NOT extrapolate the nearest quarter — a rate is legislated, not
 * interpolated), or a jurisdiction the matrix does not carry. Every consumer must report the share of
 * gallons it could price rather than dividing a partial tax sum by all of them (D-FX7, B3's rule).
 */
export function dieselTaxAt(state: string | null | undefined, date: string | null | undefined): DieselTaxRate | null {
  if (!state || !date) return null;
  const code = state.trim().toUpperCase();
  const quarter = dieselTaxQuarterFor(date);
  if (!quarter) return null;
  const surcharge = quarter.returnSurchargePerGal[code] ?? 0;
  const pump = quarter.pumpPerGal[code];
  if (pump == null) {
    // A jurisdiction that taxes by the mile genuinely carries no per-gallon tax in its pump price, so
    // zero is the measured answer here and `basis` is what stops it being read as cheap fuel.
    if (weightMileReason(code) == null) return null;
    return { state: code, pumpPerGal: 0, basis: "weight_mile", returnSurchargePerGal: surcharge, version: quarter.version, final: quarter.final };
  }
  return { state: code, pumpPerGal: pump, basis: "per_gallon", returnSurchargePerGal: surcharge, version: quarter.version, final: quarter.final };
}
