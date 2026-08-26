/**
 * Why the fuel bill moved — the OPERATING bridge (pure, dataset-free).
 *
 * `varianceBridge` in this same folder answers the procurement half of the question: of a change in
 * spend, how much was the market, and how much was buying the same gallons in worse places. It cannot
 * answer the other half, because a vendor statement does not know how far the trucks went. This module
 * takes the daily rollup (`fuel_spend_days`, migration 0244) and answers that half:
 *
 *     Δspend  =  price effect  +  volume effect
 *     volume  =  more miles  +  worse (or better) MPG  +  gallons whose miles we cannot measure
 *     miles   =  more trucks  +  more miles per truck
 *
 * Every split is an IDENTITY, not an estimate — each returns its residual so a chart can assert it
 * rather than trust it. On the real 2026-08-10 → 2026-08-17 pair the first split reproduces the
 * $41,251 change to the dollar.
 *
 * ── WHY MILES ARE SCALED TO THE MEASURED MPG ─────────────────────────────────────────────────────
 * Fleet MPG is Σ`milesMeasured` ÷ Σ`mpgGallons`, never ÷ Σ`gallonsTractor` (migration 0244, D-FS3): an
 * odometer interval that failed its plausibility gate loses its miles but keeps its gallons, because
 * the fuel was still bought. That leaves the two bases different, and the first draft of this module
 * carried the difference as a third "unmeasured gallons" term.
 *
 * That was exact and useless. Measured coverage on the real 2026-08-10 → 08-17 pair moved 92.2% → 97.5%,
 * and a five-point coverage drift alone produced a −$13,400 bar. Nothing about the fuel bill changed by
 * $13,400; our ability to MEASURE it did. A boss reading that bar learns nothing and mistrusts the rest.
 *
 * So `miles` on a period is the measured miles scaled up by the measured share — the distance those
 * gallons imply at the MPG we actually observed. `milesMeasured` keeps the provable figure beside it and
 * `measuredShare` says how much is extrapolation. The assumption is explicit and mild: gallons we could
 * not pair with an odometer interval were burned at the same MPG as the ones we could. It buys an exact
 * two-term identity on TOTAL gallons — gal = miles ÷ MPG holds by construction — and it means the miles
 * figure the report divides cost by is an estimate of miles actually driven rather than of miles we
 * happened to be able to prove. When coverage is too thin for that assumption to carry, the split is
 * withheld rather than extrapolated (`MIN_MEASURED_SHARE`).
 *
 * ── WHY MPG IS GATED ─────────────────────────────────────────────────────────────────────────────
 * Weekly fleet MPG over 2026-06 reads 85.7, 55.4, 35.8, then 6.94. Only the last is real; the rest is
 * odometer contamination that survived into `miles_since_last`. A bridge that consumed those numbers
 * would report a spectacular efficiency collapse that never happened, and it would be believed. When a
 * period's MPG falls outside what a Class-8 can physically do, the split is withheld with a reason
 * instead of published with a caveat nobody reads.
 */

// ONE idle rate for the product. `smartFueling/consumption` owns it and the planner already burns
// fuel at it; declaring a second 0.8 here is how two screens start disagreeing about an idle hour.

import { MIN_MEASURED_SHARE, type SpendPeriod } from "./spendPeriodTotals.js";

/**
 * How far a decomposition may miss the total it explains before it stops claiming to tie out.
 *
 * The residual is computed BEFORE the terms are rounded for display, so it measures the identity rather
 * than the rounding: a correct split lands within float noise of zero, and a broken one misses by
 * dollars. Rounding each displayed bar to the cent can still leave the drawn bars a cent or two from the
 * drawn total — that is arithmetic and beneath any figure this report shows — but folding it into the
 * residual would mean the one number that is supposed to catch a broken bridge could no longer be
 * asserted exactly.
 */
export const BRIDGE_TIE_TOLERANCE = 0.005;

// `Math.round(-0.001 * 100) / 100` is -0, which prints as "-0" and fails an === 0 check. A bridge
// term that is exactly nothing must read as nothing.
const unsign = (n: number) => (n === 0 ? 0 : n);
const r2 = (n: number) => unsign(Math.round(n * 100) / 100);

/** One signed term of a bridge, in dollars, with the physical change behind it. */
export interface BridgeTerm {
  key: string;
  label: string;
  /** Dollars. Positive means it pushed spend UP. */
  dollars: number;
  /** The underlying movement — gallons, miles, $/gal, MPG, trucks — for the tooltip beneath the bar. */
  detail: string;
}

export interface MilesSplit {
  /** Δmiles attributable to running more (or fewer) trucks. */
  trucks: number;
  /** Δmiles attributable to each truck covering more (or fewer) miles. */
  perTruck: number;
  residual: number;
}

export interface VolumeSplit {
  /** Dollars explained by driving further, holding MPG and price at the prior period's. */
  miles: number;
  /** Dollars explained by MPG moving. Negative means efficiency improved and saved money. */
  efficiency: number;
  residual: number;
  /** True when miles + efficiency reach the volume term within `BRIDGE_TIE_TOLERANCE`. */
  tiesOut: boolean;
  /** Δmiles, itself split into more trucks vs each truck covering more ground. */
  milesFrom: MilesSplit;
  /** Share of current-period gallons whose miles are proven rather than implied. */
  measuredShare: number | null;
}

export interface OperatingBridge {
  prior: SpendPeriod;
  current: SpendPeriod;
  /** current.spend − prior.spend, tractor fuel only. */
  deltaSpend: number;
  /** Δgallons × prior $/gal. */
  volume: number;
  /** Δ$/gal × current gallons. */
  price: number;
  /** volume + price − deltaSpend, from the ROUNDED terms — what the drawn bars actually miss by. */
  residual: number;
  /** True when the bars sum to the total within `BRIDGE_TIE_TOLERANCE`. A false here is a real defect. */
  tiesOut: boolean;
  /** Null when either period cannot support an MPG figure; `withheld` says which. */
  volumeSplit: VolumeSplit | null;
  withheld: string | null;
  terms: BridgeTerm[];
}

const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const signed = (n: number, unit: string, dp = 0) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: dp })}${unit}`;

/**
 * Decompose the change in tractor-fuel spend between two periods.
 *
 * First split is Laspeyres on volume and Paasche on price — Δgal at the OLD price plus Δprice on the
 * NEW gallons — which is exact by construction and puts the interaction term with price, where a
 * rising market belongs. The alternative convention hides a rising market inside the volume bar.
 */
export function operatingBridge(prior: SpendPeriod, current: SpendPeriod): OperatingBridge {
  const deltaSpend = r2(current.spend - prior.spend);
  const price0 = prior.pricePerGal;
  const price1 = current.pricePerGal;

  // Raw first, rounded second: the residual has to see the arithmetic, not the presentation.
  const volumeRaw = price0 == null ? 0 : (current.gallons - prior.gallons) * price0;
  const priceRaw = price0 == null || price1 == null ? 0 : (price1 - price0) * current.gallons;
  const volume = r2(volumeRaw);
  const priceTerm = r2(priceRaw);
  const residual = volumeRaw + priceRaw - (current.spend - prior.spend);

  const { split, withheld } = volumeSplitOf(prior, current, price0);

  const terms: BridgeTerm[] = [
    {
      key: "price",
      label: "Pump price",
      dollars: priceTerm,
      detail:
        price0 != null && price1 != null
          ? `${signed(price1 - price0, "/gal", 4)} on ${current.gallons.toLocaleString("en-US", { maximumFractionDigits: 0 })} gal`
          : "no price basis",
    },
  ];
  if (split) {
    terms.push(
      {
        key: "miles",
        label: "Miles driven",
        dollars: split.miles,
        detail: `${signed(current.miles - prior.miles, " mi")} at ${prior.mpg?.toFixed(2)} MPG`,
      },
      {
        key: "efficiency",
        label: "Fuel efficiency",
        dollars: split.efficiency,
        detail: `${signed((current.mpg ?? 0) - (prior.mpg ?? 0), " MPG", 2)} — ${split.efficiency <= 0 ? "saved" : "cost"} ${usd(split.efficiency)}`,
      },
    );
  } else {
    terms.push({ key: "volume", label: "Gallons bought", dollars: volume, detail: signed(current.gallons - prior.gallons, " gal") });
  }

  return {
    prior,
    current,
    deltaSpend,
    volume,
    price: priceTerm,
    residual: r2(residual),
    tiesOut: Math.abs(residual) <= BRIDGE_TIE_TOLERANCE,
    volumeSplit: split,
    withheld,
    terms,
  };
}

/**
 * Split the volume term into distance and efficiency.
 *
 * `miles` is already scaled so that gal = miles ÷ MPG holds on TOTAL gallons (see the header), which
 * makes this exact:
 *   Δgal_miles      = Δmiles ÷ MPG₀
 *   Δgal_efficiency = miles₁ ÷ MPG₁ − miles₁ ÷ MPG₀
 * summing to miles₁÷MPG₁ − miles₀÷MPG₀ = Δgallons, with no third term to explain away.
 */
function volumeSplitOf(
  prior: SpendPeriod,
  current: SpendPeriod,
  price0: number | null,
): { split: VolumeSplit | null; withheld: string | null } {
  if (price0 == null) return { split: null, withheld: "No prior-period price to value the change at." };
  if (prior.mpg == null || current.mpg == null) {
    return { split: null, withheld: "No usable odometer mileage in one of the periods." };
  }
  if (!prior.mpgUsable || !current.mpgUsable) {
    const bad = !prior.mpgUsable ? prior : current;
    const thin = bad.measuredShare != null && bad.measuredShare < MIN_MEASURED_SHARE;
    return {
      split: null,
      withheld: thin
        ? `Only ${Math.round((bad.measuredShare ?? 0) * 100)}% of the fuel for ${bad.from} → ${bad.to} could be paired with usable odometer mileage, so miles and efficiency would be mostly extrapolation. Withheld until odometer coverage improves.`
        : `Fleet MPG of ${bad.mpg?.toFixed(1)} for ${bad.from} → ${bad.to} is outside what a tractor can do, so the odometer is wrong rather than the fuel. Miles and efficiency are withheld until it is fixed.`,
    };
  }

  // gal = miles ÷ MPG, so Δgal splits exactly into the miles term at the OLD efficiency plus what the
  // change in efficiency did to the NEW distance. The two reconstruct Δgallons with no residual.
  //
  // Distance is taken as gallons × MPG rather than from the rounded `miles` field on purpose: `miles` is
  // that product rounded to two places, and dividing a rounded product back out leaves a residual that
  // is tiny, real, and impossible to assert away. Reading it from the two stored quantities the identity
  // is actually defined over keeps the split exact.
  const miles0 = prior.gallons * prior.mpg;
  const miles1 = current.gallons * current.mpg;
  const dGalMiles = (miles1 - miles0) / prior.mpg;
  const dGalEff = miles1 / current.mpg - miles1 / prior.mpg;

  const milesRaw = dGalMiles * price0;
  const effRaw = dGalEff * price0;
  const residual = milesRaw + effRaw - (current.gallons - prior.gallons) * price0;
  const split: VolumeSplit = {
    miles: r2(milesRaw),
    efficiency: r2(effRaw),
    residual: r2(residual),
    tiesOut: Math.abs(residual) <= BRIDGE_TIE_TOLERANCE,
    milesFrom: milesSplit(prior, current),
    measuredShare: current.measuredShare,
  };
  return { split, withheld: null };
}

/** Δmiles = more trucks (at the old miles per truck) + each truck covering more ground. Exact. */
function milesSplit(prior: SpendPeriod, current: SpendPeriod): MilesSplit {
  const mpt0 = prior.milesPerTruck;
  const mpt1 = current.milesPerTruck;
  if (mpt0 == null || mpt1 == null) return { trucks: 0, perTruck: r2(current.miles - prior.miles), residual: 0 };
  const trucksRaw = (current.activeTrucks - prior.activeTrucks) * mpt0;
  const perTruckRaw = current.activeTrucks * (mpt1 - mpt0);
  return {
    trucks: r2(trucksRaw),
    perTruck: r2(perTruckRaw),
    residual: r2(trucksRaw + perTruckRaw - (current.miles - prior.miles)),
  };
}

// Re-exported so every existing importer of `operatingBridge` keeps working: the split is about file
// size and reading order, not about moving anybody's import.
export {
  PLAUSIBLE_FLEET_MPG, MIN_MEASURED_SHARE, MIN_IDLE_COVERAGE,
  periodTotals, sumSpendDays, periodTotalsFromSums,
  type SpendDay, type SpendPeriod, type SpendDaySums, type PeriodOptions,
} from "./spendPeriodTotals.js";
