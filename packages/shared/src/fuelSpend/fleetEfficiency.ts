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
 * ── THE WIRE SHAPE ─────────────────────────────────────────────────────────────────────────────
 * `GET /api/fueling/fleet-mpg` answers with one of these, and it lives HERE rather than in the
 * service that assembles it for the reason CLAUDE.md gives: a contract shared by the API and the web
 * has one home, and a per-app copy is a workaround with a delay fuse. Every field beyond `FleetMpg`
 * is something a reader needs in order to judge the figure rather than merely display it.
 */
export interface FleetMpgPeriod extends FleetMpg {
  /** The period, echoed back as the caller's own inclusive days. */
  from: string;
  to: string;
  /** The fleet clock the days were resolved on — the boundary both sources were cut at. */
  timezone: string;
  /** Trucks that bought fuel in the period. The population `truckCoverage` is a share of. */
  trucksFuelled: number;
  /** Tractor gallons on fills attributed to no truck. Part of `gallons`, never of `gallonsWithMiles`. */
  unattributedGallons: number;
  /** Odometer readings the window held, lookback included. Zero means the collector has not run yet. */
  readings: number;
}

/**
 * A window and the calendar buckets inside it (D-MPG6 — week grain or coarser).
 *
 * `total` is the window measured as ITS OWN period, never the mean of `periods`: bucket edges cut
 * odometer intervals, a truck measurable across a month need not be measurable in each of its weeks,
 * and averaging the buckets' ratios would be a mean of ratios. A headline and the trend beneath it
 * are two honest measurements at two grains, not one reconstructed from the other.
 */
export interface FleetMpgSeries {
  total: FleetMpgPeriod;
  periods: FleetMpgPeriod[];
  grain: "week" | "month";
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

/**
 * A single FILL's plausible MPG band — a different band from `PLAUSIBLE_FLEET_MPG`, on purpose.
 *
 * A fleet's monthly figure cannot honestly be 2 or 15; one fill's can, and often is, without the
 * truck being unusual: a top-off after barely moving reads high, a fill following a missed one reads
 * low, and both are real purchases on a working truck. Outside 1–40 the odometer is corrupt (blank,
 * mistyped, or a prior fill never recorded) rather than the driving unusual, and one such fill can
 * move a subject's whole figure. The fill itself is still surfaced by the anomaly engine — this band
 * decides only whether its span may be used as a measurement.
 *
 * Moved here from `dashboard.ts` on 2026-09-04 (M4) so that every threshold this plan's arithmetic
 * applies lives beside the arithmetic. Re-exported from its old home; no importer moved.
 */
export const MPG_PLAUSIBLE_MIN = 1;
export const MPG_PLAUSIBLE_MAX = 40;

/** Whether one fill's stored `computed_mpg` may be used as a measurement at all. */
export const plausibleFillMpg = (n: number): boolean =>
  Number.isFinite(n) && n >= MPG_PLAUSIBLE_MIN && n <= MPG_PLAUSIBLE_MAX;

/**
 * One fill, as a subject's MPG needs to see it. Both fields come straight off `fuel_transactions`.
 */
export interface SubjectFill {
  /** `miles_since_last` — the odometer span from this truck's previous fill. Null when there is none. */
  miles: number | null;
  /** `computed_mpg` — the scorer's own ratio for that span. Null when the span could not be taken. */
  mpg: number | null;
  /** `gallons` — what was bought. Always real, whether or not a mile can be put behind it. */
  gallons: number;
}

export interface SubjectMpg {
  /** Miles per gallon for this subject, or null with a `reason`. Never zero as a stand-in. */
  mpg: number | null;
  /** Always `fill_interval`: a subject's miles are odometer spans between its own fills. */
  milesSource: FleetMilesSource;
  miles: number;
  gallons: number;
  gallonsWithMiles: number;
  measuredShare: number | null;
  fills: number;
  /** Fills whose span could be used. The rest are counted, never treated as zero-mile fills. */
  fillsMeasured: number;
  reason: string | null;
}

/**
 * MPG for ONE subject — a driver, a truck, a filtered set of fills (M4, D-MPG3).
 *
 * ── THIS IS NOT THE FLEET'S NUMBER AND MUST NOT BE LABELLED AS IT ──────────────────────────────
 * It answers "what did these fills achieve", over odometer spans between the subject's OWN fills.
 * The fleet figure answers "how far did the fleet go on the fuel it bought", over two odometer
 * readings the vendor asserted at the two ends of the period. They cover different miles, different
 * gallons and different edges, and a label that invites the two to be compared is itself the defect
 * D-MPG3 names. Every caller of this function is expected to say whose figure it is.
 *
 * ── THE NUMERATOR AND THE DENOMINATOR, AND WHY NEITHER IS THE OBVIOUS ONE ──────────────────────
 * The obvious per-subject figure is the gallon-weighted mean of `computed_mpg`, which is what all
 * four Method-A sites computed and what §1.4 of the plan measured running 1.31% then 2.41% below an
 * independent witness. The mechanism (Q5) is exact and is what this avoids: the scorer stores
 * `computed_mpg = milesSinceLast ÷ (gallons + intermediateGallons)`, where the intermediate gallons
 * are fuel bought for the same truck BETWEEN the two odometer readings. Weighting that ratio by
 * `gallons` alone multiplies the miles back out short by the intermediate share.
 *
 * So this never multiplies. It sums the spans as the numerator, and for the denominator it recovers
 * the gallons each span actually burned — `miles ÷ mpg`, which by the scorer's own definition IS
 * `gallons + intermediateGallons`. The intermediate fill contributes its fuel to the span that
 * consumed it instead of being dropped (which would read high) or paired with a span it did not
 * belong to (which is the bias above). The result is a ratio of sums with nothing reconstructed.
 *
 * A fill whose span cannot be used — no odometer, or a `computed_mpg` outside `MPG_PLAUSIBLE_MIN/MAX`
 * — still counts its gallons in `gallons`, so `measuredShare` says how much of the subject's fuel the
 * figure speaks for. It is gated on the same `MIN_MEASURED_SHARE` the fleet figure uses, because
 * D-MPG4's argument does not weaken when the subject gets smaller: a driver's MPG over a third of
 * their fuel reads entirely plausibly and is wrong.
 */
export function computeSubjectMpg(fills: readonly SubjectFill[]): SubjectMpg {
  let miles = 0;
  let gallons = 0;
  let gallonsWithMiles = 0;
  let fillsMeasured = 0;

  for (const f of fills) {
    const g = Math.max(0, finite(f.gallons));
    gallons += g;
    if (f.miles == null || f.mpg == null) continue;
    const span = finite(f.miles);
    const ratio = finite(f.mpg);
    // `plausibleFillMpg` also rejects a zero or negative ratio, which is what keeps the division
    // below finite: the band starts at 1.
    if (!(span > 0) || !plausibleFillMpg(ratio)) continue;
    miles += span;
    // The gallons this span actually burned, recovered from the scorer's own definition rather than
    // assumed to be this fill's. See the header.
    gallonsWithMiles += span / ratio;
    fillsMeasured += 1;
  }

  const measuredShare = gallons > 0 ? gallonsWithMiles / gallons : null;
  const base = {
    milesSource: "fill_interval" as const,
    miles: round2(miles),
    gallons: round2(gallons),
    gallonsWithMiles: round2(gallonsWithMiles),
    measuredShare: measuredShare == null ? null : Math.round(measuredShare * 1000) / 1000,
    fills: fills.length,
    fillsMeasured,
  };

  if (gallons <= 0) return { ...base, mpg: null, reason: "No fuel was bought, so there is nothing to divide." };
  if (gallonsWithMiles <= 0 || miles <= 0) {
    return {
      ...base,
      mpg: null,
      reason:
        "None of these fills has an odometer span behind it, so there are no miles to divide by. " +
        "A fill with no reading is not a fill that covered no distance.",
    };
  }
  if (measuredShare != null && measuredShare < MIN_MEASURED_SHARE) {
    return {
      ...base,
      mpg: null,
      reason:
        `Only ${pct(measuredShare)} of this fuel has an odometer span behind it, and ${pct(MIN_MEASURED_SHARE)} is needed. ` +
        `The rest would have to be guessed at.`,
    };
  }

  const mpg = round2(miles / gallonsWithMiles);
  if (!plausibleFillMpg(mpg)) {
    return {
      ...base,
      mpg: null,
      reason: `The spans and the fuel imply ${mpg.toFixed(1)} MPG, which is an odometer fault rather than a driving result.`,
    };
  }
  return { ...base, mpg, reason: null };
}
