/** The anomaly rules + runAllRules (docs/09). Rule functions are private; runAllRules is the entry. */
import type { AnomalySeverity } from "../constants.js";
import { computeFillConfidence, ruleEligible } from "../fillConfidence.js";
import { SUPPRESSED_RULE_IDS, type RuleId } from "./ids.js";
import type { RuleContext, RuleResult, Rule } from "./types.js";
import { effectiveCapacityGal } from "./types.js";
import { hoursBetween, daysBetween, milesSinceLast, milesSinceLastSourced, computedMpg, coldWeatherDeratePct, recentMpgSeries, effectiveBaseline, isFuelVehicle, timeReliable, none, r2, median } from "./helpers.js";
import { ruleRapidRepeatFueling, ruleOffHoursFueling, ruleUnattributed, ruleCostOutlier, ruleLocationMismatch, ruleTankFillShort, ruleReeferExceedsCapacity, ruleReeferOverfuelRate, ruleReeferFuelDiversion, ruleCardMultiVehicle, ruleFuelWhileDriverHome } from "./rulesBehavioral.js";

function ruleOdometerMissing(ctx: RuleContext): RuleResult {
  const { txn, vehicle } = ctx;
  if (txn.odometer == null && txn.gallons > 0) {
    // Higher severity for fuel vehicles — odometer is essential and "leave it blank" is a dodge.
    const severity: AnomalySeverity = isFuelVehicle(vehicle) ? "high" : "medium";
    return { ruleId: "odometer_missing", fired: true, severity, message: "Fill-up recorded without an odometer reading.", evidence: { gallons: txn.gallons } };
  }
  return none("odometer_missing");
}

/** WP4: tolerance + OBD arbitration. A regression within the odometer tolerance is entry noise (driver
 *  rounded / read the dash mid-move), not a signal. And when THIS fill's entry agrees with its own OBD
 *  reading (offset-adjusted), the regression means the PREVIOUS entry was inflated — a data-quality
 *  issue on that fill, not evidence against this one → stays silent. (When this fill's entry disagrees
 *  with OBD, odometer_mismatch/entry_suspect classify the defect and runAllRules drops the redundant
 *  regression signal — same axis, same root cause, never double-shown.) */
function ruleOdometerRegression(ctx: RuleContext): RuleResult {
  const { txn, previousTxn } = ctx;
  if (txn.odometer == null || previousTxn?.odometer == null) return none("odometer_regression");
  const tol = ctx.thresholds.odometerToleranceMiles ?? 10;
  const drop = previousTxn.odometer - txn.odometer;
  if (drop <= tol) return none("odometer_regression");
  const d = odometerDiff(ctx);
  if (d != null && d.diff <= tol) return none("odometer_regression"); // this entry matches OBD → prev was wrong
  return { ruleId: "odometer_regression", fired: true, severity: "high", message: `Odometer ${txn.odometer} is ${r2(drop)} mi lower than the previous reading ${previousTxn.odometer}.`, evidence: { previous: previousTxn.odometer, current: txn.odometer, dropMiles: r2(drop), toleranceMiles: tol } };
}

function ruleOdometerStale(ctx: RuleContext): RuleResult {
  const { txn, previousTxn } = ctx;
  if (txn.odometer != null && previousTxn?.odometer != null && txn.odometer === previousTxn.odometer && txn.gallons > 0) {
    return { ruleId: "odometer_stale", fired: true, severity: "medium", message: "Odometer is unchanged from the previous fill-up despite fuel dispensed.", evidence: { odometer: txn.odometer, gallons: txn.gallons } };
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
    return { ruleId: "odometer_implausible_jump", fired: true, severity: "high", message: `Implied speed ${r2(mph)} mph exceeds the plausible maximum (${thresholds.maxPlausibleMph}).`, evidence: { miles, hours: r2(hours), impliedMph: r2(mph) } };
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
    return { ruleId: "odometer_daily_cap", fired: true, severity: "high", message: `Implied ${r2(perDay)} miles/day exceeds the plausible maximum (${cap}).`, evidence: { miles, days: r2(days), milesPerDay: r2(perDay) } };
  }
  return none("odometer_daily_cap");
}

/** Cross-source odometer reconciliation (docs/09 §2). A cross-source odometer diff this large (miles) is not a plausible theft mask — real odometer padding is
 *  hundreds of miles. It's a driver-entry typo (e.g. a transposed digit) or an OBD glitch → route to the
 *  data-quality rule (odometer_entry_suspect, weight 0), NOT the theft-weighted odometer_mismatch. */
const ODOMETER_DATA_QUALITY_MILES = 5000;

/** Shared cross-source odometer comparison (offset-adjusted). null when either reading is absent. */
function odometerDiff(ctx: RuleContext): { entered: number; otherSource: number; offset: number; expected: number; diff: number } | null {
  const { txn, crossSourceOdometer, vehicle } = ctx;
  if (txn.odometer == null || crossSourceOdometer == null) return null;
  // Many trucks read a fixed amount apart from Samsara's OBD odometer (replaced cluster, OBD calibration).
  // Apply the learned/overridden per-vehicle offset so that constant gap doesn't false-flag every fill.
  const offset = vehicle.odometerOffset ?? 0;
  const expected = crossSourceOdometer + offset;
  return { entered: txn.odometer, otherSource: crossSourceOdometer, offset, expected, diff: Math.abs(txn.odometer - expected) };
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
    return { ruleId: "odometer_mismatch", fired: true, severity: "high", message: `Entered odometer ${d.entered} differs from the fuel-card reading ${d.otherSource}${offsetNote} by ${r2(d.diff)} mi (tolerance ${tol}).`, evidence: { entered: d.entered, otherSource: d.otherSource, offset: r2(d.offset), expected: r2(d.expected), diff: r2(d.diff), toleranceMiles: tol } };
  }
  return none("odometer_mismatch");
}

/** Data-quality classification of an implausibly large cross-source odometer diff — "check this entry", not
 *  theft. Low severity, zero theft weight, so it never inflates a correlated case (the 27k-row class). */
function ruleOdometerEntrySuspect(ctx: RuleContext): RuleResult {
  const d = odometerDiff(ctx);
  if (d == null) return none("odometer_entry_suspect");
  if (d.diff > ODOMETER_DATA_QUALITY_MILES) {
    return { ruleId: "odometer_entry_suspect", fired: true, severity: "low", message: `Entered odometer ${d.entered} differs from the fuel-card reading ${d.otherSource} by ${r2(d.diff)} mi — implausibly large, so this looks like a mistyped odometer or a telematics glitch to verify, not fuel theft.`, evidence: { entered: d.entered, otherSource: d.otherSource, expected: r2(d.expected), diff: r2(d.diff), dataQualityThresholdMiles: ODOMETER_DATA_QUALITY_MILES } };
  }
  return none("odometer_entry_suspect");
}

/** Single-source odometer plausibility vs fuel: catches odometer padding (drove far more than fuel allows). */
function ruleExpectedOdometerBand(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns } = ctx;
  const miles = milesSinceLast(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  const spanGallons = txn.gallons + (ctx.intermediateGallons ?? 0); // fuel burned across the whole span (WP4)
  if (miles == null || baseline == null || baseline <= 0 || spanGallons <= 0) return none("expected_odometer_band");
  const expectedMiles = spanGallons * baseline;
  if (miles > expectedMiles * 2) {
    return { ruleId: "expected_odometer_band", fired: true, severity: "medium", message: `Miles since last (${miles}) far exceed what ${r2(spanGallons)} gal could cover (~${r2(expectedMiles)} mi) — possible odometer over-reporting or a missed fill.`, evidence: { milesSinceLast: miles, spanGallons: r2(spanGallons), baselineMpg: r2(baseline), expectedMiles: r2(expectedMiles) } };
  }
  return none("expected_odometer_band");
}

function ruleExceedsTankCapacity(ctx: RuleContext): RuleResult {
  const { txn, vehicle, thresholds } = ctx;
  const cap = effectiveCapacityGal(vehicle); // learned combined capacity when available, else entered
  const limit = cap * (1 + thresholds.capacityTolerancePct / 100);
  if (cap > 0 && txn.gallons > limit) {
    return { ruleId: "exceeds_tank_capacity", fired: true, severity: "critical", message: `Dispensed ${txn.gallons} gal exceeds the ${cap} gal tank — fuel cannot fit.`, evidence: { gallons: txn.gallons, capacity: cap, enteredCapacity: vehicle.tankCapacityGal, tolerancePct: thresholds.capacityTolerancePct } };
  }
  return none("exceeds_tank_capacity");
}

/**
 * PHYSICAL tank-space check (the automated version of "he can't put in more than the tank holds"):
 * before fueling the tank was at P% of a C-gallon tank, so only C·(1−P/100) gallons of empty space
 * existed. If the card billed materially MORE than that space, the excess fuel could not have gone into
 * this truck — it went somewhere else. Uses only the reliable PRE-fill level (not the noisy post-fill
 * plateau). Tolerance absorbs sensor coarseness. Silent (never fires) when level/capacity are missing.
 */
/** A pre-fill level at/above this % means the tank was essentially full, so a large billed fill can't be
 *  real — the reading is stale/mistimed. Above this, the physical tank-space check is suppressed. */
const TANK_NEARLY_FULL_PCT = 90;

function ruleTankSpaceExceeded(ctx: RuleContext): RuleResult {
  const { txn, vehicle, tankPctBefore } = ctx;
  // Reconciling ONE fill against ONE sensed tank's free space is only valid when the sensor reflects the
  // whole fill (learned tankSensorReliable). On a dual-saddle-tank truck the sensor reads one tank at 92%
  // while the OTHER tank has room, so billed > sensed-tank-space false-flags every both-tank fill.
  // Tank-sensor-reliability gate centralized in ruleEligible/computeFillConfidence (docs/12).
  const cap = effectiveCapacityGal(vehicle); // learned combined capacity when available, else entered (P-2)
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
      evidence: { gallons: txn.gallons, tankPctBefore: r2(tankPctBefore), capacity: cap, freeSpaceGal: r2(freeSpace), overflowGal: r2(over), toleranceGal: r2(tol) },
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
    return { ruleId: "implausible_topoff", fired: true, severity: "high", message: `Dispensed ${r2(spanGallons)} gal far exceeds the ~${r2(expectedConsumed)} gal consumed since the last fill.`, evidence: { spanGallons: r2(spanGallons), milesSinceLast: miles, baselineMpg: r2(baseline), expectedConsumed: r2(expectedConsumed) } };
  }
  return none("implausible_topoff");
}

/** Net-unaccounted gallons the window purchase must exceed the burnable+tank ceiling by before firing —
 *  a documented fuel-loss threshold (~>10 gal) that keeps a marginal excess from false-firing. */
const CUMULATIVE_OVERFUEL_MARGIN_GAL = 10;

/** Rolling-window reconciliation: fuel purchased can't exceed fuel burnable in the window + one tank. */
function ruleCumulativeOverfuel(ctx: RuleContext): RuleResult {
  const { vehicle, recentTxns, thresholds } = ctx;
  const windowGallons = ctx.windowGallons ?? 0;
  const windowMiles = ctx.windowMiles ?? null;
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (windowGallons <= 0 || baseline == null || baseline <= 0 || windowMiles == null) return none("cumulative_overfuel");
  const cap = effectiveCapacityGal(vehicle); // learned combined capacity when available, else entered
  const burnable = windowMiles / baseline;
  // Ceiling = fuel burnable over the window + one empty-to-full tank of slack. Require the overage to clear a
  // net-unaccounted floor (documented industry practice: ~>10 gal) so a marginal excess never fires.
  const ceiling = burnable + cap + CUMULATIVE_OVERFUEL_MARGIN_GAL;
  if (windowGallons > ceiling) {
    const hrs = thresholds.cumulativeWindowHours ?? 48;
    return { ruleId: "cumulative_overfuel", fired: true, severity: "high", message: `Purchased ${r2(windowGallons)} gal in ${hrs}h but could burn only ~${r2(burnable)} gal over ${windowMiles} mi (+${cap} gal tank).`, evidence: { windowGallons: r2(windowGallons), windowMiles, burnable: r2(burnable), tankCapacity: cap, windowHours: hrs } };
  }
  return none("cumulative_overfuel");
}

function ruleMpgDeviation(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns, thresholds } = ctx;
  // Per-fill MPG = miles ÷ THIS fill's gallons. Only reliable when fills reconcile with the tank (to-full,
  // single effective tank). On an irregular / dual-tank fill the gallons are inflated vs the miles, so MPG
  // looks artificially low → false deviation. Gross overfueling is still caught by cumulative_overfuel.
  // Tank-sensor-reliability gate centralized in ruleEligible/computeFillConfidence (docs/12).
  const mpg = computedMpg(txn, previousTxn, ctx.intermediateGallons ?? 0);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (mpg == null || baseline == null || baseline <= 0) return none("mpg_deviation");
  // Allow a wider drop in cold months (diesel legitimately loses ~5–10% MPG in severe cold) so winter fills
  // don't false-fire. Derate only widens the band; it never makes the rule fire when it otherwise wouldn't.
  const coldDerate = coldWeatherDeratePct(txn.fueledAt, ctx.ambientTempF);
  const effectiveDropPct = thresholds.mpgDropPct + coldDerate;
  const floor = baseline * (1 - effectiveDropPct / 100);
  if (mpg < floor) {
    const coldNote = coldDerate ? ` (allowing +${coldDerate}% for cold-weather economy)` : "";
    return { ruleId: "mpg_deviation", fired: true, severity: "high", message: `MPG ${mpg} is ${r2(((baseline - mpg) / baseline) * 100)}% below the baseline ${r2(baseline)}${coldNote}.`, evidence: { computedMpg: mpg, baselineMpg: r2(baseline), dropPct: thresholds.mpgDropPct, coldWeatherDeratePct: coldDerate, effectiveDropPct } };
  }
  return none("mpg_deviation");
}

function ruleMpgSustainedDecline(ctx: RuleContext): RuleResult {
  const { txn, recentTxns } = ctx;
  // Built from per-fill MPGs — same reliability caveat as mpg_deviation: a run of irregular / dual-tank
  // fills drags the recent median down artificially. Reliability gate centralized in ruleEligible (docs/12).
  const series = recentMpgSeries([...recentTxns, txn]);
  if (series.length < 6) return none("mpg_sustained_decline");
  const last3 = median(series.slice(-3));
  const prior3 = median(series.slice(-6, -3));
  // Base 10% decline threshold, widened by the cold-weather allowance (P-6b) so a legitimate fall→winter
  // economy decline doesn't false-fire. Only ever widens the band.
  const coldDerate = coldWeatherDeratePct(txn.fueledAt, ctx.ambientTempF);
  const declineFactor = 1 - (10 + coldDerate) / 100;
  if (prior3 > 0 && last3 < prior3 * declineFactor) {
    const coldNote = coldDerate ? ` (allowing +${coldDerate}% for cold-weather economy)` : "";
    return { ruleId: "mpg_sustained_decline", fired: true, severity: "medium", message: `Recent MPG (${r2(last3)}) has declined more than ${10 + coldDerate}% versus the prior period (${r2(prior3)})${coldNote}.`, evidence: { recentMedian: r2(last3), priorMedian: r2(prior3), coldWeatherDeratePct: coldDerate } };
  }
  return none("mpg_sustained_decline");
}

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
    ...(fuel ? [ruleExceedsTankCapacity, ruleTankSpaceExceeded, ruleImplausibleTopoff, ruleCumulativeOverfuel] : []),
    // Tier 3 — efficiency (fuel vehicles only)
    ...(fuel ? [ruleMpgDeviation, ruleMpgSustainedDecline] : []),
    // Tier 4 — behavioral
    ...(timeOk ? [ruleRapidRepeatFueling, ruleOffHoursFueling] : []),
    ruleUnattributed,
    ruleCostOutlier,
    ruleCardMultiVehicle,
    ruleFuelWhileDriverHome,
    ruleLocationMismatch,
    ...(fuel ? [ruleTankFillShort] : []),
    // Reefer-diversion runs on TRACTOR (ULSD) fills of reefer-hauling trucks (behavioral; no sensor needed).
    ...(fuel ? [ruleReeferFuelDiversion] : []),
    // Tier A — reefer rules run ONLY on reefer (ULSR) fills (tractor rules were gated off for them).
    ...(ctx.txn.tankType === "reefer" ? [ruleReeferExceedsCapacity, ruleReeferOverfuelRate] : []),
  ];

  const suppressed = new Set<RuleId>(SUPPRESSED_RULE_IDS);
  // Confidence gating in ONE place (docs/12 Phase 1): a rule may fire only when the fill's inputs support it
  // (e.g. per-fill tank/volume/consumption rules need a reliable tank sensor; the absolute odometer mismatch
  // needs an OBD cross-source reading). `ruleEligible` reproduces the previous per-rule inline guards exactly.
  const confidence = computeFillConfidence(ctx);
  let results = rules
    .map((rule) => rule(ctx))
    .filter((r) => r.fired && !disabled.has(r.ruleId) && !suppressed.has(r.ruleId) && ruleEligible(r.ruleId, confidence));

  // Precedence: an over-capacity fill makes the per-fill top-off rule redundant.
  if (results.some((r) => r.ruleId === "exceeds_tank_capacity")) {
    results = results.filter((r) => r.ruleId !== "implausible_topoff");
  }
  // P-1: an entered odometer that disagrees with the trusted OBD reading (mismatch / entry-suspect) makes
  // miles derived FROM that entry untrustworthy → suppress the miles-based per-fill rules so one bad entry
  // can't stack a false multi-axis case. WP2: suppress ONLY when the miles CAME from the entered odometer —
  // an OBD-span basis is independent of the bad entry, so those rules stay valid (closes the "enter garbage
  // >5,000 mi to silence the consumption checks" evasion). No-OBD trucks keep the suppression.
  const odoDoubt = results.some((r) => r.ruleId === "odometer_mismatch" || r.ruleId === "odometer_entry_suspect");
  if (odoDoubt && milesSinceLastSourced(ctx.txn, ctx.previousTxn)?.basis !== "obd") {
    const milesDerived = new Set<RuleId>(["mpg_deviation", "implausible_topoff", "expected_odometer_band"]);
    results = results.filter((r) => !milesDerived.has(r.ruleId));
  }
  // WP4: a mismatch/entry-suspect already CLASSIFIES this fill's bad entry; a regression caused by the
  // same entry is the same defect on the same axis — never double-shown.
  if (odoDoubt) results = results.filter((r) => r.ruleId !== "odometer_regression");
  return results;
}

