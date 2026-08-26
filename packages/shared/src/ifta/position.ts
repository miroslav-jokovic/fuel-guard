/**
 * The IFTA position — what the carrier owes each jurisdiction against what it has already paid there.
 *
 * ── THE ARITHMETIC, AND WHY THE MONTHLY SUMMARY IS ENOUGH FOR IT ─────────────────────────────────
 * An IFTA return never attributes a particular gallon to a particular state. Per jurisdiction, per
 * quarter, it is:
 *
 *     gallons consumed in J  =  taxable miles in J ÷ fleet MPG
 *     liability              =  gallons consumed in J × J's rate
 *     credit                 =  gallons PURCHASED in J × J's rate
 *     net                    =  liability − credit          (positive = owed, negative = refundable)
 *
 * So per-vehicle-per-month jurisdiction miles are not an approximation of the tax question — they are
 * the whole input to it. Per-segment detail answers a different question (which fill, which road) and
 * is not needed here.
 *
 * ── THE MPG IS MEASURED FROM BOTH SOURCES AND IS NEVER A CONSTANT (D-IF5) ────────────────────────
 * Liability scales linearly with MPG, so a hardcoded 6.5 would move every jurisdiction's figure by
 * whatever the fleet actually differs from it. It is computed here as Samsara's total miles ÷ our
 * total purchased gallons, over the same period, and **reported beside every figure it produced**.
 *
 * That also makes the position self-checking. On 2026 Q2 the implied MPG came out at **10.5** — no
 * tractor achieves that — and chasing it found a 31-day hole in the fuel data worth about $1.03M
 * (2026-04-18 → 2026-05-18). `assessMpg` below is that check, shipped rather than left as a spike:
 * a period whose implied MPG is outside a plausible band produces a position that says so, loudly,
 * because a liability computed on the wrong denominator looks exactly like one computed on the right.
 *
 * ── WHAT IS DELIBERATELY NOT NETTED ──────────────────────────────────────────────────────────────
 * Kentucky's and Virginia's SURCHARGES are levied on the return over gallons burned there, with no
 * credit for tax-paid gallons. They are reported as their own line rather than folded into `net`,
 * because a figure that mixes a creditable tax with a non-creditable one cannot be reconciled against
 * a filed return.
 */
import { dieselTaxAt } from "../fuelTax/taxTable.js";
// Unrounded, and NOT `samsara`'s `metersToMiles`, which rounds to a tenth of a mile. Over ~2,600
// (truck, jurisdiction) rows a quarter that rounding discards miles belonging to no jurisdiction at
// all. `smartFueling/units.ts` exists for exactly this distinction and says so in its own header.
import { milesFromMeters } from "../smartFueling/units.js";

/** One (jurisdiction, period) row of stored miles. `samsara_ifta_jurisdiction_miles`, summed per truck. */
export interface IftaJurisdictionMiles {
  jurisdiction: string;
  taxableMeters: number;
  totalMeters: number;
  /** Samsara's own view. Not used in the arithmetic — see `tieOut.ts` for why. */
  taxPaidLiters: number;
}

/** One fuel purchase, ours. `tranDate` selects the tax quarter; `jurisdiction` is the purchase state. */
export interface IftaFuelPurchase {
  jurisdiction: string;
  tranDate: string;
  gallons: number;
}

export interface IftaJurisdictionPosition {
  jurisdiction: string;
  taxableMiles: number;
  totalMiles: number;
  /** `taxableMiles ÷ fleetMpg`. Null when the MPG could not be measured. */
  gallonsConsumed: number | null;
  gallonsPurchased: number;
  /** The jurisdiction's diesel rate for this period, or null when the table cannot price it. */
  ratePerGal: number | null;
  liability: number | null;
  credit: number | null;
  /** `liability − credit`. Positive is owed; negative is a credit the carrier has already paid for. */
  net: number | null;
  /** Levied on the return over gallons BURNED here, uncreditable. Kept out of `net` — see the header. */
  surcharge: number | null;
  /** False when the tax table cannot price this jurisdiction — reported, never treated as zero tax. */
  priced: boolean;
}

export type MpgVerdict = "plausible" | "implausibly_high" | "implausibly_low" | "unmeasurable";

export interface MpgAssessment {
  /** Samsara's total miles ÷ our purchased gallons, over the period. */
  fleetMpg: number | null;
  verdict: MpgVerdict;
  totalMiles: number;
  totalGallons: number;
  /** Plain words for a surface. Null when the verdict is `plausible`. */
  concern: string | null;
}

export interface IftaPosition {
  jurisdictions: IftaJurisdictionPosition[];
  mpg: MpgAssessment;
  /** Sums over the PRICED jurisdictions only. A share that is not 1 is stated beside them. */
  liability: number;
  credit: number;
  net: number;
  surcharge: number;
  /** Miles the tax table could price, over all miles. Null when there are none. */
  pricedMileShare: number | null;
  /** Jurisdictions carrying miles that could not be priced — named, so the gap is nameable. */
  unpriced: string[];
}

/**
 * The band outside which an implied fleet MPG means the INPUTS are wrong rather than the fleet is.
 *
 * ── WHY THIS IS NOT `PLAUSIBLE_FLEET_MPG`, WHICH ALREADY EXISTS ─────────────────────────────────
 * `spendPeriodTotals.ts` carries `PLAUSIBLE_FLEET_MPG = { low: 3, high: 12 }` and it is NOT the same
 * question. That one judges a single truck-period's odometer reading, where genuine oddities are
 * common — a short window, a tow, a corrected reading — so it has to be wide enough to admit them.
 * This one judges a whole fleet over a whole month, where that noise has averaged out, so it can be
 * tighter. Reusing the wider band would have been the obvious economy and it would have MISSED the
 * defect that motivated this module: the 2026 Q2 implied MPG was **10.5**, comfortably inside 3–12,
 * and it was the signature of a 31-day hole in the fuel feed worth about $1.03M.
 *
 * Two names because two questions, and each says which population it judges. The bound: a loaded
 * Class-8 runs 5.5–8.5, and this fleet measures 6.88–7.26 across three independent readings
 * (`baseline_mpg` 6.92, F13's observed 7.08, and the trucks whose Samsara miles agree with the
 * odometer at 7.26). Not a performance target, and never to be read as one.
 */
export const IFTA_MPG_BAND = { min: 4, max: 9.5 } as const;

/**
 * Is the denominator of every liability figure below believable?
 *
 * High means miles without fuel behind them — the signature of missing fuel data, which is exactly
 * what it caught. Low means fuel without miles: a mileage feed that stopped, or fuel bought for
 * something that is not a tractor.
 */
export function assessMpg(totalMiles: number, totalGallons: number): MpgAssessment {
  if (!(totalGallons > 0) || !(totalMiles > 0)) {
    return {
      fleetMpg: null, verdict: "unmeasurable", totalMiles, totalGallons,
      concern: "No fleet MPG could be measured for this period, so no liability can be computed from it.",
    };
  }
  const fleetMpg = totalMiles / totalGallons;
  if (fleetMpg > IFTA_MPG_BAND.max) {
    return {
      fleetMpg, verdict: "implausibly_high", totalMiles, totalGallons,
      concern:
        `The miles and the fuel imply ${fleetMpg.toFixed(1)} mpg, which no tractor achieves — there are ` +
        "miles here with no fuel behind them. The usual cause is a gap in the fuel feed, not a gap in " +
        "the mileage, and every liability below is overstated until it is closed.",
    };
  }
  if (fleetMpg < IFTA_MPG_BAND.min) {
    return {
      fleetMpg, verdict: "implausibly_low", totalMiles, totalGallons,
      concern:
        `The miles and the fuel imply ${fleetMpg.toFixed(1)} mpg, which is too low to be real driving — ` +
        "there is fuel here with no miles behind it. Either the mileage feed is short, or fuel was " +
        "bought for something that is not a tractor.",
    };
  }
  return { fleetMpg, verdict: "plausible", totalMiles, totalGallons, concern: null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute the position for one period.
 *
 * `rateDate` is any date inside the period: IFTA rates are quarterly, so every day of a month shares
 * one rate, and passing the date rather than deriving it keeps this pure and lets a caller price a
 * period that spans a rate change by calling twice.
 */
export function computeIftaPosition(
  miles: readonly IftaJurisdictionMiles[],
  purchases: readonly IftaFuelPurchase[],
  rateDate: string,
): IftaPosition {
  // Sum the miles per jurisdiction first: the stored rows are per TRUCK, and a position is per fleet.
  const byJurisdiction = new Map<string, { taxable: number; total: number }>();
  for (const m of miles) {
    const code = m.jurisdiction.trim().toUpperCase();
    const a = byJurisdiction.get(code) ?? { taxable: 0, total: 0 };
    a.taxable += milesFromMeters(m.taxableMeters);
    a.total += milesFromMeters(m.totalMeters);
    byJurisdiction.set(code, a);
  }

  const purchased = new Map<string, number>();
  let totalGallons = 0;
  for (const p of purchases) {
    if (!(p.gallons > 0)) continue;
    const code = p.jurisdiction.trim().toUpperCase();
    purchased.set(code, (purchased.get(code) ?? 0) + p.gallons);
    totalGallons += p.gallons;
  }

  const totalMiles = [...byJurisdiction.values()].reduce((s, a) => s + a.taxable, 0);
  const mpg = assessMpg(totalMiles, totalGallons);

  // A jurisdiction with purchases but no miles is still a jurisdiction: the carrier bought fuel there
  // and holds a credit for it, whether or not Samsara recorded a mile.
  const codes = new Set([...byJurisdiction.keys(), ...purchased.keys()]);
  const jurisdictions: IftaJurisdictionPosition[] = [];
  let pricedMiles = 0;
  const unpriced: string[] = [];

  for (const code of codes) {
    const m = byJurisdiction.get(code) ?? { taxable: 0, total: 0 };
    const gallonsPurchased = purchased.get(code) ?? 0;
    const rate = dieselTaxAt(code, rateDate);
    const priced = rate != null && rate.basis === "per_gallon";
    if (priced) pricedMiles += m.taxable;
    else if (m.taxable > 0) unpriced.push(code);

    const gallonsConsumed = mpg.fleetMpg == null ? null : m.taxable / mpg.fleetMpg;
    const ratePerGal = priced ? rate!.pumpPerGal : null;
    const liability = ratePerGal != null && gallonsConsumed != null ? r2(gallonsConsumed * ratePerGal) : null;
    const credit = ratePerGal != null ? r2(gallonsPurchased * ratePerGal) : null;

    jurisdictions.push({
      jurisdiction: code,
      taxableMiles: Math.round(m.taxable),
      totalMiles: Math.round(m.total),
      gallonsConsumed: gallonsConsumed == null ? null : Math.round(gallonsConsumed * 10) / 10,
      gallonsPurchased: Math.round(gallonsPurchased * 10) / 10,
      ratePerGal,
      liability,
      credit,
      net: liability != null && credit != null ? r2(liability - credit) : null,
      // Uncreditable and therefore never inside `net`. Zero for the 46 jurisdictions that levy none.
      surcharge:
        rate != null && gallonsConsumed != null && rate.returnSurchargePerGal > 0
          ? r2(gallonsConsumed * rate.returnSurchargePerGal)
          : rate != null
            ? 0
            : null,
      priced,
    });
  }

  jurisdictions.sort((a, b) => (b.net ?? 0) - (a.net ?? 0));
  const sum = (pick: (j: IftaJurisdictionPosition) => number | null) =>
    r2(jurisdictions.reduce((s, j) => s + (pick(j) ?? 0), 0));

  return {
    jurisdictions,
    mpg,
    liability: sum((j) => j.liability),
    credit: sum((j) => j.credit),
    net: sum((j) => j.net),
    surcharge: sum((j) => j.surcharge),
    pricedMileShare: totalMiles > 0 ? pricedMiles / totalMiles : null,
    unpriced: unpriced.sort(),
  };
}
