/** Tier 2 capacity and volume rules. Each rule takes RuleContext and returns RuleResult. */
import type { RuleContext, RuleResult } from "./types.js";
import {
  capacityAlertTolerancePct,
  resolveCapacity,
  SENSOR_CAP_MIN_RISE_PCT,
  SENSOR_CAP_PHYSICAL_MAX_GAL,
} from "./capacityResolve.js";
import { effectiveBaseline, milesSinceLast, none, r2 } from "./helpers.js";

/**
 * WP-CAP self-corroboration guard, shared by both capacity rules: when the capacity number is UNVERIFIED
 * (no sensor-learned capacity yet) but THIS fill carries raw before/after sensor percentages, the fill's
 * own implied capacity (billed ÷ rise-fraction) tells us whether the fuel physically went into the truck.
 * A big rise whose implied capacity is physically plausible means the tank demonstrably absorbed ~the
 * billed gallons — the capacity RECORD is too small, not the fill dishonest → suppress (the sensor
 * learner + divergence surfacing converge the record within a few fills). A rise too small for the bill
 * (implied capacity beyond any real tank) is the opposite: the fuel did NOT go in — the alert stands.
 * Never applied to sensor-VERIFIED capacity: there, a contradicting single fill is evidence of theft,
 * not record error (the learner's cluster requirement means one fill can't move the verified value).
 */
function fillSelfDemonstratesCapacity(ctx: RuleContext): boolean {
  const { txn } = ctx;
  const pb = ctx.tankPctBefore;
  const pa = ctx.tankPctAfter;
  if (pb == null || pa == null) return false;
  const riseFrac = (pa - pb) / 100;
  if (riseFrac < SENSOR_CAP_MIN_RISE_PCT / 100) return false; // rise too small to measure against
  const impliedCap = txn.gallons / riseFrac;
  return impliedCap <= SENSOR_CAP_PHYSICAL_MAX_GAL;
}

function ruleExceedsTankCapacity(ctx: RuleContext): RuleResult {
  const { txn, vehicle, thresholds } = ctx;
  const rc = resolveCapacity(vehicle); // sensor-measured > entered > billed-history, with confidence (WP-CAP)
  if (rc.gallons <= 0 || txn.gallons <= 0) return none("exceeds_tank_capacity");
  // Verified capacity keeps the tight org tolerance; an unverified entered number needs a 15% overage
  // before this weight-85 alert-alone rule fires (the 5–15% band on unverified trucks goes to the
  // review-grade exceeds_capacity_unverified instead — nothing goes silent, nothing over-fires).
  const tolPct = capacityAlertTolerancePct(rc.confidence, thresholds.capacityTolerancePct);
  const limit = rc.gallons * (1 + tolPct / 100);
  if (txn.gallons <= limit) return none("exceeds_tank_capacity");
  // Unverified record + this fill's own sensor rise proves the fuel went in → record error, not theft.
  if (rc.confidence === "low" && fillSelfDemonstratesCapacity(ctx))
    return none("exceeds_tank_capacity");
  // Independent corroboration for the message/evidence: a measured rise far below the bill means the
  // fuel demonstrably did NOT all go into this truck.
  const rise = ctx.tankObservedRiseGal;
  const riseCorroborates = rise != null && rise < txn.gallons * 0.6;
  const capNote =
    rc.source === "sensor" || rc.source === "sensor+entered" ? "sensor-measured " : "";
  const riseNote = riseCorroborates ? ` The tank only absorbed ~${r2(rise)} gal of it.` : "";
  return {
    ruleId: "exceeds_tank_capacity",
    fired: true,
    severity: "critical",
    message: `Dispensed ${txn.gallons} gal exceeds the ${capNote}${r2(rc.gallons)} gal tank — fuel cannot fit.${riseNote}`,
    evidence: {
      gallons: txn.gallons,
      capacity: r2(rc.gallons),
      capacitySource: rc.source,
      capacityConfidence: rc.confidence,
      capacityDivergent: rc.divergent,
      enteredCapacity: vehicle.tankCapacityGal,
      sensorCapacity: rc.sensorGal,
      tolerancePct: tolPct,
      observedRiseGal: rise ?? null,
      riseCorroborates,
    },
  };
}

/**
 * Review-grade companion to exceeds_tank_capacity for UNVERIFIED capacity records (no sensor-learned
 * capacity): a fill in the 5–15% overage band is suspicious but the capacity number it exceeds is a
 * human-typed field — historically the #1 false-critical source. Weight 60 → raises a review on its
 * own, never an alert-alone critical; once the sensor verifies the capacity, the band disappears (the
 * main rule fires at the tight tolerance instead).
 */
function ruleExceedsCapacityUnverified(ctx: RuleContext): RuleResult {
  const { txn, vehicle, thresholds } = ctx;
  const rc = resolveCapacity(vehicle);
  if (rc.confidence !== "low" || rc.gallons <= 0 || txn.gallons <= 0)
    return none("exceeds_capacity_unverified");
  const basePct =
    Number.isFinite(thresholds.capacityTolerancePct) && thresholds.capacityTolerancePct > 0
      ? thresholds.capacityTolerancePct
      : 5;
  const alertPct = capacityAlertTolerancePct(rc.confidence, thresholds.capacityTolerancePct);
  const lower = rc.gallons * (1 + basePct / 100);
  const upper = rc.gallons * (1 + alertPct / 100);
  if (txn.gallons <= lower || txn.gallons > upper) return none("exceeds_capacity_unverified");
  if (fillSelfDemonstratesCapacity(ctx)) return none("exceeds_capacity_unverified");
  const over = txn.gallons - rc.gallons;
  return {
    ruleId: "exceeds_capacity_unverified",
    fired: true,
    severity: "medium",
    message: `Dispensed ${txn.gallons} gal is ~${r2(over)} gal over the entered ${r2(rc.gallons)} gal capacity — but that capacity is not yet sensor-verified, so this is flagged for review, not as theft.`,
    evidence: {
      gallons: txn.gallons,
      capacity: r2(rc.gallons),
      capacitySource: rc.source,
      capacityConfidence: rc.confidence,
      enteredCapacity: vehicle.tankCapacityGal,
      overGal: r2(over),
      reviewBandPct: [basePct, alertPct],
    },
  };
}

/**
 * PHYSICAL tank-space check (the automated version of "he can't put in more than the tank holds"):
 * before fueling the tank was at P% of a C-gallon tank, so only C·(1−P/100) gallons of empty space
 * existed. If the card billed materially MORE than that space, the excess fuel could not have gone into
 * this truck — it went somewhere else. Uses only the reliable PRE-fill level (not the noisy post-fill
 * plateau). Tolerance absorbs sensor coarseness. Silent (never fires) when level/capacity are missing.
 */
/** A pre-fill level at/above this % means the tank was essentially full, so a large billed fill can't be
 * real — the reading is stale/mistimed. Above this, the physical tank-space check is suppressed. */
const TANK_NEARLY_FULL_PCT = 90;

function ruleTankSpaceExceeded(ctx: RuleContext): RuleResult {
  const { txn, vehicle, tankPctBefore } = ctx;
  // Reconciling ONE fill against ONE sensed tank's free space is only valid when the sensor reflects the
  // whole fill (learned tankSensorReliable). On a dual-saddle-tank truck the sensor reads one tank at 92%
  // while the OTHER tank has room, so billed > sensed-tank-space false-flags every both-tank fill.
  // Tank-sensor-reliability gate centralized in ruleEligible/computeFillConfidence (docs/12).
  const cap = resolveCapacity(vehicle).gallons; // sensor-measured > entered > billed-history (WP-CAP)
  if (tankPctBefore == null || cap <= 0 || txn.gallons <= 0) return none("tank_space_exceeded");
  // Physical-contradiction guard: you cannot put a meaningful fill into an already-near-full tank, so a large
  // billed fill against a pre-fill level this high means the reading is stale/mistimed (wrong-time sensor
  // sample), not theft. Suppress rather than false-fire. Real over-space fills start from a low/moderate tank.
  if (tankPctBefore >= TANK_NEARLY_FULL_PCT) return none("tank_space_exceeded");
  const freeSpace = cap * (1 - Math.min(Math.max(tankPctBefore, 0), 100) / 100);
  // Tolerance for sensor coarseness: the larger of 12 gal or 10% of the tank.
  const tol = Math.max(12, cap * 0.1);
  const over = txn.gallons - freeSpace;
  // Independent post-fill corroboration (audit A2.3): tankPctBefore is a SINGLE pre-fill sensor sample; a
  // stale/mistimed one reads high (understating free space) and false-fires a lone weight-90 critical. But if
  // the sensor then shows the tank actually ROSE by ~the billed gallons, the fuel physically went into THIS
  // truck — so the pre-fill sample was wrong, not evidence of overflow. Suppress. We still fire when the
  // observed rise is SHORT (fuel didn't all go in → corroborates the overflow) or when no rise was measured.
  const observedRise = ctx.tankObservedRiseGal;
  if (observedRise != null && observedRise >= txn.gallons - tol) return none("tank_space_exceeded");
  if (over > tol) {
    return {
      ruleId: "tank_space_exceeded",
      fired: true,
      severity: "critical",
      message: `Billed ${txn.gallons} gal, but the tank was ${r2(tankPctBefore)}% full before fueling — only ~${r2(freeSpace)} gal of space existed. ~${r2(over)} gal could not fit in this truck.`,
      evidence: {
        gallons: txn.gallons,
        tankPctBefore: r2(tankPctBefore),
        capacity: cap,
        freeSpaceGal: r2(freeSpace),
        overflowGal: r2(over),
        toleranceGal: r2(tol),
      },
    };
  }
  return none("tank_space_exceeded");
}

function ruleImplausibleTopoff(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns } = ctx;
  // "Dispensed > consumed since last fill" is only meaningful when fills reconcile with the tank (learned
  // reliable). If a truck ran a tank low then filled both, dispensing more than it burned is NORMAL — the
  // extra fuel filled pre-existing space — so this false-fires on dual-tank / irregular (not-to-full) fills.
  // Tank-sensor-reliability gate centralized in ruleEligible/computeFillConfidence (docs/12).
  const miles = milesSinceLast(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns); // rolling, not static seed
  if (miles == null || baseline == null || baseline <= 0) return none("implausible_topoff");
  const expectedConsumed = miles / baseline;
  const spanGallons = txn.gallons + (ctx.intermediateGallons ?? 0); // incl. skipped-fill fuel (WP4)
  if (spanGallons > expectedConsumed * 1.3 && txn.gallons > 5) {
    return {
      ruleId: "implausible_topoff",
      fired: true,
      severity: "high",
      message: `Dispensed ${r2(spanGallons)} gal far exceeds the ~${r2(expectedConsumed)} gal consumed since the last fill.`,
      evidence: {
        spanGallons: r2(spanGallons),
        milesSinceLast: miles,
        baselineMpg: r2(baseline),
        expectedConsumed: r2(expectedConsumed),
      },
    };
  }
  return none("implausible_topoff");
}

/** Net-unaccounted gallons the window purchase must exceed the burnable+tank ceiling by before firing —
 * a documented fuel-loss threshold (~>10 gal) that keeps a marginal excess from false-firing. */
const CUMULATIVE_OVERFUEL_MARGIN_GAL = 10;

/** Rolling-window reconciliation: fuel purchased can't exceed fuel burnable in the window + one tank. */
function ruleCumulativeOverfuel(ctx: RuleContext): RuleResult {
  const { vehicle, recentTxns, thresholds } = ctx;
  const windowGallons = ctx.windowGallons ?? 0;
  const windowMiles = ctx.windowMiles ?? null;
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (windowGallons <= 0 || baseline == null || baseline <= 0 || windowMiles == null)
    return none("cumulative_overfuel");
  const cap = resolveCapacity(vehicle).gallons; // sensor-measured > entered > billed-history (WP-CAP)
  const burnable = windowMiles / baseline;
  // 2026-08 — MEASURED idle burn. The miles→MPG conversion is blind to fuel burned while parked: a
  // truck that drove 84 mi in 48h while idling 30h (sleeper HVAC, hot-weather) really burned ~25 gal
  // the odometer never shows, and that exact profile was this rule's residual false-review class.
  // The allowance comes ONLY from synced engine-time measurement (vehicle_engine_days), never from
  // assumption — no idle data leaves the ceiling exactly as before.
  const idleGal = ctx.windowIdleGallons != null && ctx.windowIdleGallons > 0 ? ctx.windowIdleGallons : 0;
  // Ceiling = fuel burnable over the window + measured idle burn + one empty-to-full tank of slack.
  // Require the overage to clear a net-unaccounted floor (documented industry practice: ~>10 gal) so a
  // marginal excess never fires.
  const ceiling = burnable + idleGal + cap + CUMULATIVE_OVERFUEL_MARGIN_GAL;
  if (windowGallons > ceiling) {
    const hrs = thresholds.cumulativeWindowHours ?? 48;
    // WP-ATTR: windowGallons already EXCLUDES logbook-contradicted fills (another truck's fuel — the
    // driver-changed-truck false-alert class); the excluded volume is carried in evidence for review.
    const suspectGal = ctx.windowSuspectGallons ?? 0;
    const idleNote = idleGal > 0 ? ` and ~${r2(idleGal)} gal of measured idling` : "";
    return {
      ruleId: "cumulative_overfuel",
      fired: true,
      severity: "high",
      message: `Purchased ${r2(windowGallons)} gal in ${hrs}h but could burn only ~${r2(burnable)} gal over ${windowMiles} mi${idleNote} (+${cap} gal tank).`,
      evidence: {
        windowGallons: r2(windowGallons),
        windowMiles,
        burnable: r2(burnable),
        idleAllowanceGal: r2(idleGal),
        tankCapacity: cap,
        windowHours: hrs,
        ...(suspectGal > 0 ? { attributionSuspectExcludedGal: r2(suspectGal) } : {}),
      },
    };
  }
  return none("cumulative_overfuel");
}

export {
  ruleExceedsTankCapacity,
  ruleExceedsCapacityUnverified,
  ruleTankSpaceExceeded,
  ruleImplausibleTopoff,
  ruleCumulativeOverfuel,
};
