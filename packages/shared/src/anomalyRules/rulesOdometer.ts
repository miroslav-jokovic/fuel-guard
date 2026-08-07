/** Tier 1 odometer rules. Each rule takes RuleContext and returns RuleResult. */
import type { AnomalySeverity } from "../constants.js";
import type { RuleContext, RuleResult } from "./types.js";
import {
  daysBetween,
  effectiveBaseline,
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
  const hours = hoursBetween(previousTxn.fueledAt, txn.fueledAt);
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

/** Single-source odometer plausibility vs fuel: catches odometer padding (drove far more than fuel allows). */
function ruleExpectedOdometerBand(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns } = ctx;
  const miles = milesSinceLast(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  const spanGallons = txn.gallons + (ctx.intermediateGallons ?? 0); // fuel burned across the whole span (WP4)
  if (miles == null || baseline == null || baseline <= 0 || spanGallons <= 0)
    return none("expected_odometer_band");
  const expectedMiles = spanGallons * baseline;
  if (miles > expectedMiles * 2) {
    return {
      ruleId: "expected_odometer_band",
      fired: true,
      severity: "medium",
      message: `Miles since last (${miles}) far exceed what ${r2(spanGallons)} gal could cover (~${r2(expectedMiles)} mi) — possible odometer over-reporting or a missed fill.`,
      evidence: {
        milesSinceLast: miles,
        spanGallons: r2(spanGallons),
        baselineMpg: r2(baseline),
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
