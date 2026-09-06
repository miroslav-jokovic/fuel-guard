/** Tier 1 odometer rules. Each rule takes RuleContext and returns RuleResult. */
import type { AnomalySeverity } from "../constants.js";
import type { RuleContext, RuleResult } from "./types.js";
import { resolveCapacity } from "./capacityResolve.js";
import {
  daysBetween,
  effectiveBaseline,
  eventTime,
  hoursBetween,
  isFuelVehicle,
  milesSinceLast,
  none,
  r2,
} from "./helpers.js";

function ruleOdometerMissing(ctx: RuleContext): RuleResult {
  const { txn, vehicle } = ctx;
  if (txn.odometer == null && txn.gallons > 0) {
    // Higher severity for fuel vehicles — odometer is essential and "leave it blank" is a dodge.
    const severity: AnomalySeverity = isFuelVehicle(vehicle) ? "high" : "medium";
    return {
      ruleId: "odometer_missing",
      fired: true,
      severity,
      message: "Fill-up recorded without an odometer reading.",
      evidence: { gallons: txn.gallons },
    };
  }
  return none("odometer_missing");
}

/** WP4: tolerance + OBD arbitration. A regression within the odometer tolerance is entry noise (driver
 * rounded / read the dash mid-move), not a signal. And when THIS fill's entry agrees with its own OBD
 * reading (offset-adjusted), the regression means the PREVIOUS entry was inflated — a data-quality
 * issue on that fill, not evidence against this one → stays silent. (When this fill's entry disagrees
 * with OBD, odometer_mismatch/entry_suspect classify the defect and runAllRules drops the redundant
 * regression signal — same axis, same root cause, never double-shown.) */
function ruleOdometerRegression(ctx: RuleContext): RuleResult {
  const { txn, previousTxn } = ctx;
  if (txn.odometer == null || previousTxn?.odometer == null) return none("odometer_regression");
  const tol = ctx.thresholds.odometerToleranceMiles ?? 10;
  const drop = previousTxn.odometer - txn.odometer;
  if (drop <= tol) return none("odometer_regression");
  const d = odometerDiff(ctx);
  if (d != null && d.diff <= tol) return none("odometer_regression"); // this entry matches OBD → prev was wrong
  return {
    ruleId: "odometer_regression",
    fired: true,
    severity: "high",
    message: `Odometer ${txn.odometer} is ${r2(drop)} mi lower than the previous reading ${previousTxn.odometer}.`,
    evidence: {
      previous: previousTxn.odometer,
      current: txn.odometer,
      dropMiles: r2(drop),
      toleranceMiles: tol,
    },
  };
}

function ruleOdometerStale(ctx: RuleContext): RuleResult {
  const { txn, previousTxn } = ctx;
  if (
    txn.odometer != null &&
    previousTxn?.odometer != null &&
    txn.odometer === previousTxn.odometer &&
    txn.gallons > 0
  ) {
    return {
      ruleId: "odometer_stale",
      fired: true,
      severity: "medium",
      message: "Odometer is unchanged from the previous fill-up despite fuel dispensed.",
      evidence: { odometer: txn.odometer, gallons: txn.gallons },
    };
  }
  return none("odometer_stale");
}

function ruleOdometerImplausibleJump(ctx: RuleContext): RuleResult {
  const { txn, previousTxn, thresholds } = ctx;
  const miles = milesSinceLast(txn, previousTxn);
  if (miles == null || !previousTxn) return none("odometer_implausible_jump");
  // eventTime(), not fueledAt — the SAME clock the gate in rules.ts used to choose this rule over
  // odometer_daily_cap (it selects on timeReliable(), which is a property of eventTime). fueledAt is
  // the business timestamp and is never overwritten, so for an EFS date-only row it stays the
  // noon-UTC sentinel even after telematics recovers the real fuelling instant. Measuring against it
  // meant two corroborated fills on the same tran date gave hours = 0 and the rule returned silently,
  // while the two sibling rules that ask the same question (rapid_repeat_fueling, impossible_travel)
  // both used eventTime and fired correctly. Because the gate is exclusive, odometer_daily_cap was
  // not registered either — so odometer padding on recovered EFS fills went completely unchecked
  // (audit 2026-08-09, finding 4.1b).
  const hours = hoursBetween(eventTime(previousTxn), eventTime(txn));
  if (hours <= 0) return none("odometer_implausible_jump");
  const mph = miles / hours;
  if (mph > thresholds.maxPlausibleMph) {
    return {
      ruleId: "odometer_implausible_jump",
      fired: true,
      severity: "high",
      message: `Implied speed ${r2(mph)} mph exceeds the plausible maximum (${thresholds.maxPlausibleMph}).`,
      evidence: { miles, hours: r2(hours), impliedMph: r2(mph) },
    };
  }
  return none("odometer_implausible_jump");
}

/** Date-precision (EFS) fallback for implausible jumps — uses miles/day instead of mph. */
function ruleOdometerDailyCap(ctx: RuleContext): RuleResult {
  const { txn, previousTxn, thresholds } = ctx;
  const miles = milesSinceLast(txn, previousTxn);
  if (miles == null || !previousTxn) return none("odometer_daily_cap");
  const days = Math.max(daysBetween(previousTxn.fueledAt, txn.fueledAt), 1);
  const perDay = miles / days;
  const cap = thresholds.maxDailyMiles ?? 1000;
  if (perDay > cap) {
    return {
      ruleId: "odometer_daily_cap",
      fired: true,
      severity: "high",
      message: `Implied ${r2(perDay)} miles/day exceeds the plausible maximum (${cap}).`,
      evidence: { miles, days: r2(days), milesPerDay: r2(perDay) },
    };
  }
  return none("odometer_daily_cap");
}

/** Cross-source odometer reconciliation (docs/09 §2). A cross-source odometer diff this large (miles) is not a plausible theft mask — real odometer padding is
 * hundreds of miles. It's a driver-entry typo (e.g. a transposed digit) or an OBD glitch → route to the
 * data-quality rule (odometer_entry_suspect, weight 0), NOT the theft-weighted odometer_mismatch. */
const ODOMETER_DATA_QUALITY_MILES = 5000;

/** Shared cross-source odometer comparison (offset-adjusted). null when either reading is absent. */
function odometerDiff(
  ctx: RuleContext,
): { entered: number; otherSource: number; offset: number; expected: number; diff: number } | null {
  const { txn, crossSourceOdometer, vehicle } = ctx;
  if (txn.odometer == null || crossSourceOdometer == null) return null;
  // Many trucks read a fixed amount apart from Samsara's OBD odometer (replaced cluster, OBD calibration).
  // Apply the learned/overridden per-vehicle offset so that constant gap doesn't false-flag every fill.
  const offset = vehicle.odometerOffset ?? 0;
  const expected = crossSourceOdometer + offset;
  return {
    entered: txn.odometer,
    otherSource: crossSourceOdometer,
    offset,
    expected,
    diff: Math.abs(txn.odometer - expected),
  };
}

function ruleOdometerMismatch(ctx: RuleContext): RuleResult {
  // OBD-only confidence gate centralized in ruleEligible/computeFillConfidence (docs/12).
  const d = odometerDiff(ctx);
  if (d == null) return none("odometer_mismatch");
  const tol = ctx.thresholds.odometerToleranceMiles ?? 10;
  // A real, theft-plausible discrepancy: beyond tolerance but NOT so huge it must be a data error (that case
  // is odometer_entry_suspect). This keeps a bogus 27,000-mi diff out of the theft correlation.
  if (d.diff > tol && d.diff <= ODOMETER_DATA_QUALITY_MILES) {
    const offsetNote = d.offset ? ` (after a learned +${r2(d.offset)} mi calibration)` : "";
    return {
      ruleId: "odometer_mismatch",
      fired: true,
      severity: "high",
      message: `Entered odometer ${d.entered} differs from the fuel-card reading ${d.otherSource}${offsetNote} by ${r2(d.diff)} mi (tolerance ${tol}).`,
      evidence: {
        entered: d.entered,
        otherSource: d.otherSource,
        offset: r2(d.offset),
        expected: r2(d.expected),
        diff: r2(d.diff),
        toleranceMiles: tol,
      },
    };
  }
  return none("odometer_mismatch");
}

/** Data-quality classification of an implausibly large cross-source odometer diff — "check this entry", not
 * theft. Low severity, zero theft weight, so it never inflates a correlated case (the 27k-row class). */
function ruleOdometerEntrySuspect(ctx: RuleContext): RuleResult {
  const d = odometerDiff(ctx);
  if (d == null) return none("odometer_entry_suspect");
  if (d.diff > ODOMETER_DATA_QUALITY_MILES) {
    return {
      ruleId: "odometer_entry_suspect",
      fired: true,
      severity: "low",
      message: `Entered odometer ${d.entered} differs from the fuel-card reading ${d.otherSource} by ${r2(d.diff)} mi — implausibly large, so this looks like a mistyped odometer or a telematics glitch to verify, not fuel theft.`,
      evidence: {
        entered: d.entered,
        otherSource: d.otherSource,
        expected: r2(d.expected),
        diff: r2(d.diff),
        dataQualityThresholdMiles: ODOMETER_DATA_QUALITY_MILES,
      },
    };
  }
  return none("odometer_entry_suspect");
}

/**
 * Single-source odometer plausibility vs fuel: catches odometer padding (drove far more than fuel allows).
 *
 * ── THE TANK DOES NOT START EMPTY, AND THIS RULE USED TO ASSUME IT DID (2026-09-05) ──────────────
 * The ceiling was `spanGallons * baseline * 2` — the miles the fuel bought AT THIS FILL could cover.
 * That is only the whole story when the truck arrived running on fumes. Every other time the miles
 * were partly paid for by fuel already in the tank, bought at the last fill, and the rule read the
 * difference as the odometer lying.
 *
 * Its mirror image next door already says so, from the other side. `implausible_topoff` asks whether
 * more was DISPENSED than could have been burned, and its header records why it needs a guard: *"If a
 * truck ran a tank low then filled both, dispensing more than it burned is NORMAL — the extra fuel
 * filled pre-existing space."* The converse is this rule's defect exactly: **driving further than you
 * bought is NORMAL, because the miles came out of pre-existing fuel.**
 *
 * ── MEASURED, BECAUSE THE SIZE OF IT WAS NOT OBVIOUS ────────────────────────────────────────────
 * Restating the rule's own condition on its own persisted inputs across 14,498 production fills
 * (2026-09-05) shows it firing in inverse proportion to how much fuel was bought — which is the
 * signature of a rule measuring the wrong thing:
 *
 *     fill size      fills     condition true
 *     < 5 gal          38          86.8%
 *     5 – 20 gal       51          82.4%
 *     20 – 50 gal     308          31.2%
 *     50+ gal      14,101           1.8%
 *
 * A truck that buys a tankful trips it once in fifty-six times; a truck that buys a splash trips it
 * six times in seven. The rule was reporting *that the fill was partial*.
 *
 * ⚠ **A 5-gallon floor — the guard `implausible_topoff` carries — was measured and is NOT what
 * shipped.** It removes 33 of 430 fires and leaves the 5–20 gal band firing at 82%: it treats the
 * symptom where it is loudest and misses the cause. Allowing for the tank takes 430 fires to 22, and
 * once it is applied the gallons floor removes nothing at all, because the small-fill class is
 * entirely contained in it.
 *
 * ── THE ALLOWANCE IS `cumulative_overfuel`'s, NOT A NUMBER CHOSEN HERE ──────────────────────────
 * `ceiling = burnable + idle + cap + margin` is how the capacity rule already handles this same
 * uncertainty: one empty-to-full tank of slack, because that is what the truck could physically have
 * been carrying. This rule takes the same allowance on the miles side, and it suppresses itself on a
 * truck with no capacity source for the same reason that one does — treating an unknown tank as 0 gal
 * is precisely the behaviour being fixed. That costs ONE of today's 430 fires; 51 of 14,498 fills sit
 * on a truck with no entered capacity.
 *
 * The `* 2` stays. It absorbs baseline error, which the tank allowance does not address, and keeping
 * it makes this change a STRICT NARROWING: `cap >= 0`, so the new ceiling is never lower than the old
 * one and nothing that was silent starts firing. A rule change that can only remove accusations is
 * the safest shape one can have.
 *
 * What survives sits 1.19x to 83x over a ceiling that already granted a full tank — 801,772 miles
 * between two fills, an implied 1,974 MPG. That is the data error this rule exists to name.
 */
function ruleExpectedOdometerBand(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns } = ctx;
  const miles = milesSinceLast(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  const spanGallons = txn.gallons + (ctx.intermediateGallons ?? 0); // fuel burned across the whole span (WP4)
  if (miles == null || baseline == null || baseline <= 0 || spanGallons <= 0)
    return none("expected_odometer_band");
  const resolved = resolveCapacity(vehicle); // sensor-measured > entered > billed-history (WP-CAP)
  // Without a capacity source this rule cannot grant the legitimate one-tank reserve, and judging with
  // a 0-gallon tank is the defect above rather than a conservative fallback. Same words, same reason,
  // as `cumulative_overfuel`.
  if (resolved.confidence === "none" || resolved.gallons <= 0) return none("expected_odometer_band");
  const tankGallons = resolved.gallons;
  const expectedMiles = (spanGallons + tankGallons) * baseline;
  if (miles > expectedMiles * 2) {
    return {
      ruleId: "expected_odometer_band",
      fired: true,
      severity: "medium",
      message: `Miles since last (${miles}) far exceed what ${r2(spanGallons)} gal plus a full ${r2(tankGallons)} gal tank could cover (~${r2(expectedMiles)} mi) — possible odometer over-reporting or a missed fill.`,
      evidence: {
        milesSinceLast: miles,
        spanGallons: r2(spanGallons),
        baselineMpg: r2(baseline),
        // Named separately from `expectedMiles` so a reviewer can see the allowance was granted, and
        // which capacity source granted it — a ceiling nobody can decompose is a ceiling nobody trusts.
        tankGallons: r2(tankGallons),
        capacitySource: resolved.source,
        expectedMiles: r2(expectedMiles),
      },
    };
  }
  return none("expected_odometer_band");
}

export {
  ruleOdometerMissing,
  ruleOdometerRegression,
  ruleOdometerStale,
  ruleOdometerImplausibleJump,
  ruleOdometerDailyCap,
  ruleOdometerMismatch,
  ruleOdometerEntrySuspect,
  ruleExpectedOdometerBand,
};
