/**
 * What a spend period IS — the truck-day row, the period it rolls up to, and the two halves of that
 * roll-up.
 *
 * ── SPLIT OUT OF `operatingBridge` (F9), ALONG THE SEAM THE CODE ALREADY HAD ─────────────────────
 * That file passed the 500-line budget once before and was split at the same kind of joint:
 * `spendPeriods` decides WHICH days belong together, the bridge decides what the difference between
 * two periods MEANS, and this decides what one period IS. Three questions, three files.
 *
 * ── AND THE SUMMATION IS SEPARABLE FROM THE JUDGEMENT ────────────────────────────────────────────
 * `sumSpendDays` adds; `periodTotalsFromSums` decides. That seam is load-bearing: `fuel_spend_by_period`
 * (0252) computes the sums in SQL so the browser stops fetching 13,000 truck-day rows to display
 * thirteen figures, and hands them straight to the derivation below — which never moved, because the
 * MPG plausibility band, the implied-miles identity and the idle coverage gate are judgements that
 * have each been got wrong once and must have exactly one implementation.
 * `apps/api/src/services/fuelSpendByPeriodParity.test.ts` runs both over the same rows.
 */
import { DEFAULT_IDLE_GAL_PER_HOUR } from "../smartFueling/consumption.js";

const unsign = (n: number) => (n === 0 ? 0 : n);
const r2 = (n: number) => unsign(Math.round(n * 100) / 100);
const r3 = (n: number) => unsign(Math.round(n * 1000) / 1000);
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);


// Both constants moved to `fleetEfficiency.ts` on 2026-09-04 (M1, D-MPG1): fleet MPG is defined in
// exactly one file now, and a threshold that decides whether an MPG may be printed belongs beside the
// function that decides it. Re-exported here so every existing importer keeps its import — the move
// is about where the definition LIVES, not about making anybody chase it.
import { MIN_MEASURED_SHARE, PLAUSIBLE_FLEET_MPG } from "./fleetEfficiency.js";
export { MIN_MEASURED_SHARE, PLAUSIBLE_FLEET_MPG } from "./fleetEfficiency.js";

/**
 * How much of a period's wall-clock the engine feed must have actually watched before an idle figure is
 * reported at all.
 *
 * ⚠ This is a STRICTER bar than `computeAvoidable`'s, and deliberately so. That function's `minCoverage`
 * defaults to 0.5, because it is deciding whether a truck can be scored at all and would rather judge a
 * half-observed truck than drop it. This one decides whether a PERIOD TOTAL is worth printing on a spend
 * report, where a figure summed across a half-watched fortnight is not thin, it is wrong.
 *
 * (An earlier version of this comment claimed 0.8 was `computeAvoidable`'s own default. It is not — 0.8
 * is that function's `minDutyEvidencedShare`, a different threshold entirely.)
 *
 * This is load-bearing, not defensive. The Samsara engine-state feed was largely down from 2026-07-13 to
 * 07-26: 467 truck-days recorded against a normal 1,100, each covering 10.9% of its day. Idle computed
 * over those weeks reads as a collapse in idling, and a report that showed it would be congratulating
 * the fleet for a broken sync.
 */
export const MIN_IDLE_COVERAGE = 0.8;

/** One truck-day from the rollup. A `null` vehicle is the day's unattributed fuel, kept so totals tie. */
export interface SpendDay {
  day: string; // YYYY-MM-DD
  vehicleId: string | null;
  fills: number;
  gallonsTractor: number;
  gallonsReefer: number;
  gallonsDef: number;
  spendTractor: number;
  spendReefer: number;
  spendDef: number;
  /** Miles allocated to this day, already plausibility-gated upstream. */
  miles: number;
  /** The gallons those miles belong to — the ONLY denominator MPG may use. */
  mpgGallons: number;
  milesRejected: number;
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
}

export interface SpendPeriod {
  from: string;
  to: string;
  days: number;
  fills: number;
  /** Tractor propulsion fuel — the basis of every $/gal and MPG figure here. */
  gallons: number;
  spend: number;
  gallonsReefer: number;
  spendReefer: number;
  gallonsDef: number;
  spendDef: number;
  /** Everything on the fuel bill this rollup covers. Reefer and DEF are fuel; they are not tractor fuel. */
  totalSpend: number;
  /** Miles the period's gallons imply at the measured MPG — the estimate of distance actually driven. */
  miles: number;
  /** Miles we can prove from gated odometer intervals. `miles` scales this up by `measuredShare`. */
  milesMeasured: number;
  /** Gallons paired with trustworthy miles — the ONLY denominator MPG may use. */
  mpgGallons: number;
  milesRejected: number;
  /** Trucks that fuelled or drove. A truck parked all period is not diluting miles-per-truck. */
  activeTrucks: number;
  driveSec: number;
  idleSec: number;
  coverageSec: number;
  // ── derived; null rather than 0, because 0 reads as "free" or "stationary" ──
  pricePerGal: number | null;
  mpg: number | null;
  costPerMile: number | null;
  milesPerTruck: number | null;
  /**
   * Idle seconds as a share of engine-on (idle + drive) time. Null when the feed was not watching
   * enough of the period to say — see `idleCoverage`.
   */
  idleShare: number | null;
  /** Share of the period's truck-days the engine feed actually covered, 0–1. */
  idleCoverage: number | null;
  /** False when coverage is below `MIN_IDLE_COVERAGE`; every idle figure above is then null. */
  idleUsable: boolean;
  /** Fuel burned standing still, at the org's idle rate. Null when coverage cannot support it. */
  idleGallons: number | null;
  /** What that fuel cost, valued at the period's OWN price per gallon rather than a configured constant. */
  idleCost: number | null;
  /** Share of tractor gallons whose miles are measurable — how much of `miles` is proven, not implied. */
  measuredShare: number | null;
  /** False when MPG is missing, physically impossible, or too thinly measured to scale. */
  mpgUsable: boolean;
  /**
   * True when the bucket reaches beyond the data — a week the fleet is still part-way through, or the
   * clipped first week of a window that starts mid-week.
   *
   * `from`/`to` are CLAMPED to the data on a partial period, so a Monday-start week holding one day of
   * fuel reads as that one day. Left canonical, a report ending 2026-08-24 printed a row labelled
   * "2026-08-24 - 2026-08-30", six days past the window the report says it covers.
   */
  partial: boolean;
}

export interface PeriodOptions {
  /** The bucket reaches beyond the data; `from`/`to` have been clamped. */
  partial?: boolean;
  /** The org's configured idle burn rate. Defaults to `DEFAULT_IDLE_GAL_PER_HOUR`. */
  idleGalPerHour?: number;
}

/** Aggregate truck-days into one period. Empty input yields a zeroed period, never a throw. */
export function periodTotals(
  days: readonly SpendDay[],
  from: string,
  to: string,
  opts: PeriodOptions = {},
): SpendPeriod {
  return periodTotalsFromSums(sumSpendDays(days), from, to, opts);
}

/**
 * The SUMMATION half of a period, and nothing else.
 *
 * ── WHY THIS IS ITS OWN SHAPE ────────────────────────────────────────────────────────────────────
 * A ninety-day window is ~13,000 truck-day rows and thirteen weekly figures. The browser was fetching
 * all thirteen thousand — fourteen sequential PostgREST pages — to display thirteen, because the fold
 * and the derivation below were one function and the fold had to happen wherever the rows were.
 *
 * They are separable, and the seam is exactly here: everything above this line is addition, and
 * everything below it is JUDGEMENT — the MPG plausibility band, the implied-miles identity, the idle
 * coverage gate, valuing an idle hour at what the period actually paid. Addition is what a database
 * does well and what a test can verify exactly; judgement is what must have one implementation.
 *
 * So `fuel_spend_by_period` (0252) computes these sums in SQL and `periodTotalsFromSums` derives from
 * them, unchanged. The arithmetic that could go wrong quietly never moved.
 */
export interface SpendDaySums {
  /** Trucks that fuelled or drove — see the note in the fold. Not every truck with a row. */
  activeTrucks: number;
  /** Distinct calendar days the rows covered. */
  days: number;
  fills: number;
  gallonsTractor: number;
  spendTractor: number;
  gallonsReefer: number;
  spendReefer: number;
  gallonsDef: number;
  spendDef: number;
  miles: number;
  mpgGallons: number;
  milesRejected: number;
  driveSec: number;
  idleSec: number;
  coverageSec: number;
  /** Truck-days the feed could have watched — the denominator for idle coverage. */
  truckDays: number;
}

export function sumSpendDays(days: readonly SpendDay[]): SpendDaySums {
  const trucks = new Set<string>();
  const dates = new Set<string>();
  let fills = 0, gallonsRaw = 0, spendRaw = 0, gReefer = 0, sReeferRaw = 0, gDef = 0, sDefRaw = 0;
  let milesRaw = 0, mpgGallonsRaw = 0, rejected = 0, driveSec = 0, idleSec = 0, coverageSec = 0, truckDays = 0;

  for (const d of days) {
    dates.add(d.day);
    // A truck counts as ACTIVE on a day it fuelled or drove — not on a day it merely had an engine-day
    // row. The rollup emits a row for every truck the telematics feed covers, including ones parked all
    // week, and counting those dilutes miles-per-truck and turns the fleet-size term of the bridge into
    // coverage noise: on real 2026-08 data the naive count moved 172 → 166 while the working fleet grew.
    if (d.vehicleId && (d.fills > 0 || d.driveSec > 0)) trucks.add(d.vehicleId);
    fills += d.fills;
    gallonsRaw += d.gallonsTractor;
    spendRaw += d.spendTractor;
    gReefer += d.gallonsReefer;
    sReeferRaw += d.spendReefer;
    gDef += d.gallonsDef;
    sDefRaw += d.spendDef;
    milesRaw += d.miles;
    mpgGallonsRaw += d.mpgGallons;
    rejected += d.milesRejected;
    driveSec += d.driveSec;
    idleSec += d.idleSec;
    coverageSec += d.coverageSec;
    // Truck-days the feed could have watched — the denominator for coverage. The unattributed row is
    // fuel with no truck behind it and no engine time, so counting it would dilute coverage with days
    // that were never observable.
    if (d.vehicleId) truckDays += 1;
  }

  return {
    activeTrucks: trucks.size, days: dates.size, fills,
    gallonsTractor: gallonsRaw, spendTractor: spendRaw,
    gallonsReefer: gReefer, spendReefer: sReeferRaw,
    gallonsDef: gDef, spendDef: sDefRaw,
    miles: milesRaw, mpgGallons: mpgGallonsRaw, milesRejected: rejected,
    driveSec, idleSec, coverageSec, truckDays,
  };
}

/** The DERIVATION half. Unchanged from what `periodTotals` always did; it just takes sums now. */
export function periodTotalsFromSums(
  s: SpendDaySums,
  from: string,
  to: string,
  opts: PeriodOptions = {},
): SpendPeriod {
  const partial = opts.partial === true;
  const { fills, milesRejected: rejected, driveSec, idleSec, coverageSec, truckDays } = s;
  const gallonsRaw = s.gallonsTractor, spendRaw = s.spendTractor;
  const gReefer = s.gallonsReefer, sReeferRaw = s.spendReefer;
  const gDef = s.gallonsDef, sDefRaw = s.spendDef;
  const milesRaw = s.miles, mpgGallonsRaw = s.mpgGallons;
  const trucks = { size: s.activeTrucks };
  const dates = { size: s.days };

  // Derive every ratio from the values this object will actually EXPOSE, not from the raw sums behind
  // them. A bridge built on `pricePerGal` and `spend` has to see one consistent pair, or the identity it
  // asserts is off by the difference between them — which is small, invisible, and exactly the kind of
  // thing that makes a residual check unassertable.
  const gallons = r3(gallonsRaw);
  const spend = r2(spendRaw);
  const sReefer = r2(sReeferRaw);
  const sDef = r2(sDefRaw);
  const milesMeasured = r2(milesRaw);
  const mpgGallons = r3(mpgGallonsRaw);

  const mpg = ratio(milesMeasured, mpgGallons);
  const measuredShare = ratio(mpgGallons, gallons);
  const mpgUsable =
    mpg != null &&
    mpg >= PLAUSIBLE_FLEET_MPG.low &&
    mpg <= PLAUSIBLE_FLEET_MPG.high &&
    measuredShare != null &&
    measuredShare >= MIN_MEASURED_SHARE;
  // gal = miles ÷ MPG by construction, which is what makes the volume split an identity on TOTAL
  // gallons rather than on the measured subset. See the header.
  const impliedMiles = mpg != null ? gallons * mpg : milesMeasured;
  const totalSpend = r2(spend + sReefer + sDef);

  // ── idle, gated on whether the engine feed was actually watching ────────────────────────────────
  const idleCoverage = truckDays > 0 ? Math.min(1, coverageSec / (truckDays * 86_400)) : null;
  const idleUsable = idleCoverage != null && idleCoverage >= MIN_IDLE_COVERAGE && idleSec > 0;
  const idleGallons = idleUsable ? r2((idleSec / 3600) * (opts.idleGalPerHour ?? DEFAULT_IDLE_GAL_PER_HOUR)) : null;
  const pricePerGal = ratio(spend, gallons);
  // Valued at what this period ACTUALLY paid, not at a configured constant. An idle hour in a $5.22
  // week did not cost what an idle hour in a $3.96 week cost, and the whole point of costing idle is
  // to compare it against the fuel bill sitting beside it.
  const idleCost = idleGallons != null && pricePerGal != null ? r2(idleGallons * pricePerGal) : null;
  return {
    from,
    to,
    days: dates.size,
    fills,
    gallons,
    spend,
    gallonsReefer: r3(gReefer),
    spendReefer: sReefer,
    gallonsDef: r3(gDef),
    spendDef: sDef,
    totalSpend,
    miles: r2(impliedMiles),
    milesMeasured,
    mpgGallons,
    milesRejected: rejected,
    activeTrucks: trucks.size,
    driveSec,
    idleSec,
    coverageSec,
    pricePerGal,
    mpg,
    // Cost per mile deliberately uses TOTAL spend against IMPLIED miles: a boss asking what a mile costs
    // is not asking about tractor diesel alone (reefer and DEF are on the same invoice), and dividing by
    // only the miles we could prove would overstate the cost of every mile by the coverage gap.
    costPerMile: ratio(totalSpend, impliedMiles),
    milesPerTruck: trucks.size > 0 ? impliedMiles / trucks.size : null,
    idleShare: idleUsable ? ratio(idleSec, idleSec + driveSec) : null,
    idleCoverage: idleCoverage == null ? null : Math.round(idleCoverage * 1000) / 1000,
    idleUsable,
    idleGallons,
    idleCost,
    measuredShare,
    mpgUsable,
    partial,
  };
}

