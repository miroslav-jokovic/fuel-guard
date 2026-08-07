/** The anomaly rule orchestration layer (docs/09). Rule functions are private; runAllRules is the entry. */
import { computeFillConfidence, ruleEligible } from "../fillConfidence.js";
import { SUPPRESSED_RULE_IDS, type RuleId } from "./ids.js";
import type { RuleContext, RuleResult, Rule } from "./types.js";
import { isFuelVehicle, milesSinceLastSourced, timeReliable } from "./helpers.js";
import {
  ruleRapidRepeatFueling,
  ruleOffHoursFueling,
  ruleUnattributed,
  ruleCostOutlier,
  ruleCostLineMismatch,
  ruleLocationMismatch,
  ruleTankFillShort,
  ruleTankChronicShort,
  ruleImpossibleTravel,
  ruleReeferExceedsCapacity,
  ruleReeferOverfuelRate,
  ruleReeferFuelDiversion,
  ruleCardMultiVehicle,
  ruleFuelWhileDriverHome,
} from "./rulesBehavioral.js";
import {
  ruleOdometerMissing,
  ruleOdometerRegression,
  ruleOdometerStale,
  ruleOdometerImplausibleJump,
  ruleOdometerDailyCap,
  ruleOdometerMismatch,
  ruleOdometerEntrySuspect,
  ruleExpectedOdometerBand,
} from "./rulesOdometer.js";
import {
  ruleExceedsTankCapacity,
  ruleExceedsCapacityUnverified,
  ruleTankSpaceExceeded,
  ruleImplausibleTopoff,
  ruleCumulativeOverfuel,
} from "./rulesCapacity.js";
import { ruleMpgDeviation, ruleMpgSustainedDecline } from "./rulesEfficiency.js";

/**
 * Run the full rule set. Applies fuel-type gating (Tier 2/3 only for diesel/gasoline — audit H1),
 * timestamp-precision gating (time-based rules suppressed for date-only EFS rows — docs/09 P0.1),
 * rule precedence, and `disabledRules`. Returns only fired rules.
 */
export function runAllRules(ctx: RuleContext): RuleResult[] {
  const disabled = new Set(ctx.thresholds.disabledRules);
  // Tractor volume/consumption/tank rules apply only to tractor-tank fills on a fuel vehicle. A reefer
  // (ULSR) fill goes into the trailer's refrigeration tank, so comparing it to the tractor's tank
  // capacity / MPG would be nonsense — those rules are suppressed here (reefer rules come in Phase 2).
  const fuel = isFuelVehicle(ctx.vehicle) && ctx.txn.tankType !== "reefer";
  // Time-of-day and inter-fill rules need a RELIABLE instant (corroborated by telematics or manual) — an
  // uncorroborated EFS posted time may be an authorization/settlement time, not the real pump time.
  const timeOk = timeReliable(ctx.txn);
  // The implied-speed check needs BOTH endpoints to be reliable instants; a date-only previous fill
  // (noon sentinel) or an uncorroborated time fabricates the elapsed hours. Fall back to the miles/day cap.
  const prevTimeOk = ctx.previousTxn == null || timeReliable(ctx.previousTxn);

  const rules: Rule[] = [
    // Tier 1 — odometer
    ruleOdometerMissing,
    ruleOdometerRegression,
    ruleOdometerStale,
    // Jump/daily-cap are ENTERED-odometer plausibility checks. An OBD miles basis means the distance was
    // REALLY driven (e.g. a team running 1,200 mi/day) — not entry padding → neither fires (WP4); a bad
    // entry still surfaces via odometer_mismatch. Entered basis keeps the instant/date-precision split.
    ...(milesSinceLastSourced(ctx.txn, ctx.previousTxn)?.basis === "obd"
      ? []
      : [timeOk && prevTimeOk ? ruleOdometerImplausibleJump : ruleOdometerDailyCap]),
    ruleOdometerMismatch,
    ruleOdometerEntrySuspect,
    ...(fuel ? [ruleExpectedOdometerBand] : []),
    // Tier 2 — capacity (fuel vehicles only)
    ...(fuel
      ? [
          ruleExceedsTankCapacity,
          ruleExceedsCapacityUnverified,
          ruleTankSpaceExceeded,
          ruleImplausibleTopoff,
          ruleCumulativeOverfuel,
        ]
      : []),
    // Tier 3 — efficiency (fuel vehicles only)
    ...(fuel ? [ruleMpgDeviation, ruleMpgSustainedDecline] : []),
    // Tier 4 — behavioral
    ...(timeOk ? [ruleRapidRepeatFueling, ruleOffHoursFueling, ruleImpossibleTravel] : []),
    ruleUnattributed,
    ruleCostOutlier,
    ruleCostLineMismatch,
    ruleCardMultiVehicle,
    ruleFuelWhileDriverHome,
    ruleLocationMismatch,
    ...(fuel ? [ruleTankFillShort, ruleTankChronicShort] : []),
    // Reefer-diversion runs on TRACTOR (ULSD) fills of reefer-hauling trucks (behavioral; no sensor needed).
    ...(fuel ? [ruleReeferFuelDiversion] : []),
    // Tier A — reefer rules run ONLY on reefer (ULSR) fills (tractor rules were gated off for them).
    ...(ctx.txn.tankType === "reefer" ? [ruleReeferExceedsCapacity, ruleReeferOverfuelRate] : []),
  ];

  const suppressed = new Set<RuleId>(SUPPRESSED_RULE_IDS);
  // WP-ATTR: when the driver's ELD logbook contradicts this fill's vehicle attribution (uncorroborated
  // 'suspect'), every VEHICLE-RELATIVE rule is judging gallons/odometer that may belong to another
  // truck — a misattributed fill was the exact source of false tank-space/over-fuel criticals on
  // truck swaps. Suppress the physics rules (data-quality posture; the persisted attribution_verdict
  // is the "why"), keep the vehicle-independent behavioral/card/cost checks alive.
  if (ctx.attributionSuspect) {
    const vehicleRelative: RuleId[] = [
      "odometer_regression",
      "odometer_stale",
      "odometer_implausible_jump",
      "odometer_daily_cap",
      "odometer_mismatch",
      "odometer_entry_suspect",
      "expected_odometer_band",
      "exceeds_tank_capacity",
      "exceeds_capacity_unverified",
      "tank_space_exceeded",
      "implausible_topoff",
      "cumulative_overfuel",
      "mpg_deviation",
      "mpg_sustained_decline",
      "tank_fill_short",
      "tank_chronic_short",
      "rapid_repeat_fueling",
      "impossible_travel",
      "reefer_exceeds_capacity",
      "reefer_overfuel_rate",
      "reefer_fuel_diversion",
    ];
    for (const id of vehicleRelative) suppressed.add(id);
  }
  // Confidence gating in ONE place (docs/12 Phase 1): a rule may fire only when the fill's inputs support it
  // (e.g. per-fill tank/volume/consumption rules need a reliable tank sensor; the absolute odometer mismatch
  // needs an OBD cross-source reading). `ruleEligible` reproduces the previous per-rule inline guards exactly.
  const confidence = computeFillConfidence(ctx);
  let results = rules
    .map((rule) => rule(ctx))
    .filter(
      (r) =>
        r.fired &&
        !disabled.has(r.ruleId) &&
        !suppressed.has(r.ruleId) &&
        ruleEligible(r.ruleId, confidence),
    );

  // Precedence: an over-capacity fill makes the per-fill top-off rule redundant (either capacity signal),
  // and the alert-grade rule supersedes the review-grade unverified band (mutually exclusive by
  // construction; the filter is belt-and-braces).
  if (results.some((r) => r.ruleId === "exceeds_tank_capacity")) {
    results = results.filter(
      (r) => r.ruleId !== "implausible_topoff" && r.ruleId !== "exceeds_capacity_unverified",
    );
  }
  if (results.some((r) => r.ruleId === "exceeds_capacity_unverified")) {
    results = results.filter((r) => r.ruleId !== "implausible_topoff");
  }
  // P-1: an entered odometer that disagrees with the trusted OBD reading (mismatch / entry-suspect) makes
  // miles derived FROM that entry untrustworthy → suppress the miles-based per-fill rules so one bad entry
  // can't stack a false multi-axis case. WP2: suppress ONLY when the miles CAME from the entered odometer —
  // an OBD-span basis is independent of the bad entry, so those rules stay valid (closes the "enter garbage
  // >5,000 mi to silence the consumption checks" evasion). No-OBD trucks keep the suppression.
  const odoDoubt = results.some(
    (r) => r.ruleId === "odometer_mismatch" || r.ruleId === "odometer_entry_suspect",
  );
  if (odoDoubt && milesSinceLastSourced(ctx.txn, ctx.previousTxn)?.basis !== "obd") {
    const milesDerived = new Set<RuleId>([
      "mpg_deviation",
      "implausible_topoff",
      "expected_odometer_band",
    ]);
    results = results.filter((r) => !milesDerived.has(r.ruleId));
  }
  // WP4: a mismatch/entry-suspect already CLASSIFIES this fill's bad entry; a regression caused by the
  // same entry is the same defect on the same axis — never double-shown.
  if (odoDoubt) results = results.filter((r) => r.ruleId !== "odometer_regression");
  // WP-BEH: impossible travel supersedes rapid-repeat for the SAME fill pair — the physically-impossible
  // interval already says everything the merely-fast one would (never double-shown, different axes).
  if (results.some((r) => r.ruleId === "impossible_travel")) {
    results = results.filter((r) => r.ruleId !== "rapid_repeat_fueling");
  }
  return results;
}
