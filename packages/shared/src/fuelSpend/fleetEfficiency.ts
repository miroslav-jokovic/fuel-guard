/**
 * Fleet MPG — the one definition (M1, D-MPG1,
 * docs/plans/fuel/FLEET-MPG-CONSOLIDATION-PLAN.md).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 * On 2026-09-04 the owner noticed that fleet MPG read differently on different pages. It did, and by
 * more than rounding: for the week of 2026-08-25 the Fuel log showed **6.82** and the Spend trend
 * **7.55**, a 10.7% spread on the same fleet and the same week. Neither page was buggy. There were
 * three definitions of the number and five implementations of them, and nothing in the system
 * compared any two of them, so the divergence could only ever be found by a person looking at two
 * tabs.
 *
 * ── WHAT THE DISAGREEMENT ACTUALLY WAS, WHICH IS NOT WHAT IT LOOKED LIKE ────────────────────────
 * It looked like the classic error — a gallon-weighted MEAN OF RATIOS on one page against a RATIO OF
 * SUMS on the other. It was not. Each fill's `computed_mpg` is `miles ÷ gallons`, so weighting it by
 * gallons multiplies the miles back out: the "mean" reduces to `Σ fill-interval miles ÷ Σ fill
 * gallons`, a ratio of sums as well. All three definitions already were.
 *
 * **The disagreement was the numerator**, and the plan measured it against an independent witness —
 * Samsara's own IFTA jurisdiction miles, on a pipeline neither of them touches:
 *
 *     month     from per-fill spans   from allocated days   IFTA taxable     A vs IFTA   B vs IFTA
 *     2026-07        1,530,801            1,549,942          1,551,133         −1.31%      −0.08%
 *     2026-08        1,595,483            1,696,637          1,634,889         −2.41%      +3.78%
 *
 * Both miss it, in opposite directions, which is why the two pages disagreed by 10% while each
 * looked internally consistent. So this module fixes neither formula: it takes the miles as an INPUT
 * and makes the caller say where they came from.
 *
 * ── THREE RULES THIS ENCODES ───────────────────────────────────────────────────────────────────
 *
 *  1. **The provenance travels with the number.** `milesSource` is not metadata a surface may drop;
 *     it is part of the answer. A figure built on miles spread across days by drive-second weight is
 *     not the same claim as one built on two odometer readings the vendor asserted, and a reader who
 *     cannot tell them apart cannot judge either.
 *  2. **The denominator is the fuel that has a mile behind it.** Dividing measured miles by the
 *     WHOLE period's gallons understates MPG by exactly the unmeasured share — a 90%-covered fleet
 *     would read 10% low, entirely plausibly. `measuredShare` then says how much of the fleet the
 *     answer speaks for.
 *  3. **It refuses rather than approximates.** Below the coverage floor, or outside what a tractor
 *     can physically do, `mpg` is null and `reason` says why, so a surface prints a dash and can
 *     explain it. That is the G10 / D-FIN10 pattern the finance section already uses: a per-mile
 *     figure computed over part of a fleet reads low on miles and high on cost and looks completely
 *     believable, which is what makes it worse than no figure at all.
 *
 * Pure. No clock, no I/O, no table (D-ARC1). The period is the caller's; the arithmetic is here.
 */

/**
 * Where a period's miles came from, worst to best. The order is the ranking, and it is the reason
 * this is a union rather than a boolean: "measured or not" would hide that the two unmeasured
 * sources are wrong in different directions.
 *
 *  · `fill_interval` — the odometer span between consecutive fuel purchases, as `computed_mpg`
 *    implies it. Runs LOW (§1.4 above): `computedMpg` divides by `gallons + intermediateGallons`
 *    while the surfaces weight by `gallons` alone, so multiplying back out loses the intermediate
 *    share, and any fill whose implied MPG falls outside 1–40 is dropped entirely.
 *  · `allocated` — `fuel_spend_days.miles`, which is one fill-to-fill interval spread across the
 *    days it spans by drive-second weight (`rollupDerive.ts`'s `allocate()`). No day in that
 *    interval carries a distance anybody observed, and a period's edges cut intervals arbitrarily.
 *    Finance is forbidden from reading it at all (D-FLEET8).
 *  · `measured` — `distanceByVehicle` over `samsara_odometer_readings` (W3, migration 0311): the
 *    difference between two cumulative counter readings the vendor asserted, for a named truck, at
 *    the two ends of the period actually asked for. Nothing is allocated and nothing is
 *    reconstructed from the fuel.
 */
export const FLEET_MILES_SOURCES = ["fill_interval", "allocated", "measured"] as const;
export type FleetMilesSource = (typeof FLEET_MILES_SOURCES)[number];

/** Physically possible fleet MPG for a Class-8 tractor. Outside this, the odometer is wrong, not the truck. */
export const PLAUSIBLE_FLEET_MPG = { low: 3, high: 12 } as const;

/**
 * How much of a period's fuel must have a measured distance behind it before an MPG is reported.
 *
 * Below this the unmeasured remainder is carrying more of the answer than the measurement is. The
 * value is 0.6 because that is what `spendPeriodTotals` has enforced on the spend report since
 * migration 0244 and it has held; adopting it fleet-wide is a deliberate choice of ONE floor over a
 * stricter dashboard bar and a looser report bar (plan Q2). It is not the coverage of TRUCKS —
 * `truckCoverage` reports that separately and is deliberately not gated on, because a fleet where
 * 40% of the trucks are new and barely fuelled is not the same failure as one where 40% of the fuel
 * is unaccounted for.
 */
export const MIN_MEASURED_SHARE = 0.6;

export interface FleetMpgInputs {
  /** Distance the fleet covered in the period. NEVER derived from the fuel. */
  miles: number;
  /** Where that distance came from. Part of the answer, not a detail. */
  milesSource: FleetMilesSource;
  /** Tractor gallons burned in the period. Reefer and DEF move no truck and are not fuel for miles. */
  gallons: number;
  /**
   * Of `gallons`, those that have a mile behind them — the MPG's actual denominator. Equal to
   * `gallons` when every truck that fuelled could also be measured. Never greater: a caller that
   * passes more measured gallons than gallons is describing two different periods.
   */
  gallonsWithMiles: number;
  /** Trucks the distance was measured for. */
  trucksMeasured: number;
  /** Trucks that burned fuel and could not be measured. Counted, never read as zero miles (D-FIN10). */
  trucksUnmeasured: number;
}

export interface FleetMpg {
  /** Miles per gallon, or null when it cannot honestly be stated. Never zero as a stand-in. */
  mpg: number | null;
  /** Where the miles came from, always — including when `mpg` is null. */
  milesSource: FleetMilesSource;
  miles: number;
  gallons: number;
  gallonsWithMiles: number;
  /** 0–1: the share of the period's fuel with a measured distance behind it. Null when there is no fuel. */
  measuredShare: number | null;
  /** 0–1: the share of trucks behind the figure. Reported for the reader, not gated on. */
  truckCoverage: number | null;
  trucksMeasured: number;
  trucksUnmeasured: number;
  /** Why there is no figure, in words a fleet manager can act on. Null when there is one. */
  reason: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);

function withheld(computed: Omit<FleetMpg, "mpg" | "reason">, reason: string): FleetMpg {
  return { ...computed, mpg: null, reason };
}

/**
 * The fleet's miles per gallon for one period.
 *
 * The caller supplies the two totals and their provenance; this decides whether they can be divided
 * and says so either way. It never reaches for a fallback source, never scales the miles up to cover
 * the fuel it could not measure, and never returns zero for "unknown" — each of those turns a gap
 * into a number that looks like a measurement.
 */
export function computeFleetMpg(inputs: FleetMpgInputs): FleetMpg {
  const miles = Math.max(0, finite(inputs.miles));
  const gallons = Math.max(0, finite(inputs.gallons));
  // Clamped rather than trusted: `gallonsWithMiles > gallons` is not a rounding artefact, it means
  // the numerator and the denominator were read over different windows, and letting it through would
  // report a measured share above 1 as though it were extra confidence.
  const gallonsWithMiles = Math.min(gallons, Math.max(0, finite(inputs.gallonsWithMiles)));
  const trucksMeasured = Math.max(0, Math.trunc(finite(inputs.trucksMeasured)));
  const trucksUnmeasured = Math.max(0, Math.trunc(finite(inputs.trucksUnmeasured)));
  const trucks = trucksMeasured + trucksUnmeasured;

  const measuredShare = gallons > 0 ? gallonsWithMiles / gallons : null;
  const base = {
    milesSource: inputs.milesSource,
    miles: round2(miles),
    gallons: round2(gallons),
    gallonsWithMiles: round2(gallonsWithMiles),
    measuredShare: measuredShare == null ? null : Math.round(measuredShare * 1000) / 1000,
    truckCoverage: trucks > 0 ? Math.round((trucksMeasured / trucks) * 1000) / 1000 : null,
    trucksMeasured,
    trucksUnmeasured,
  };

  if (gallons <= 0) {
    return withheld(base, "No tractor fuel was purchased in this period, so there is nothing to divide.");
  }
  if (gallonsWithMiles <= 0) {
    return withheld(
      base,
      "No fuel in this period has a measured distance behind it — the fleet's mileage feed has nothing for these trucks.",
    );
  }
  if (miles <= 0) {
    return withheld(
      base,
      "No distance was measured in this period. Trucks that reported nothing are not trucks that stood still.",
    );
  }
  if (measuredShare != null && measuredShare < MIN_MEASURED_SHARE) {
    return withheld(
      base,
      `Only ${pct(measuredShare)} of this period's fuel has a measured distance behind it, and ${pct(MIN_MEASURED_SHARE)} is needed. ` +
        `The remaining fuel would have to be guessed at, and a fleet MPG over part of a fleet reads plausibly and is wrong.`,
    );
  }

  const mpg = round2(miles / gallonsWithMiles);
  if (mpg < PLAUSIBLE_FLEET_MPG.low || mpg > PLAUSIBLE_FLEET_MPG.high) {
    return withheld(
      base,
      `The miles and the fuel imply ${mpg.toFixed(1)} MPG, which is outside what a tractor can do (${PLAUSIBLE_FLEET_MPG.low}–${PLAUSIBLE_FLEET_MPG.high}). ` +
        `The distance is wrong rather than the fuel — fuel is a purchase and miles are a measurement.`,
    );
  }

  return { ...base, mpg, reason: null };
}

/**
 * How far apart two independent measurements of the same period's distance are, as a fraction of the
 * reference.
 *
 * This exists because of what §1.4 of the plan found: `fuel_spend_days.miles` agreed with Samsara's
 * IFTA miles to within 0.08% in July 2026 and ran 3.78% ahead of them in August, and the step landed
 * in the week of 2026-07-28. Nothing noticed for five weeks, because nothing in the product ever put
 * the two numbers side by side. A ratio of sums CAN be tied out against an independent source; that
 * is most of the argument for D-MPG1, and it is worth nothing unless something actually does it.
 *
 * Returns null when either side has no distance to compare — an absent feed is not agreement.
 */
export function mileageDivergence(miles: number, referenceMiles: number): number | null {
  const a = finite(miles);
  const b = finite(referenceMiles);
  if (!(a > 0) || !(b > 0)) return null;
  return Math.round(((a - b) / b) * 10_000) / 10_000;
}
