/** The anomaly rules + runAllRules (docs/09). Rule functions are private; runAllRules is the entry. */
import type { AnomalySeverity } from "../constants.js";
import { computeFillConfidence, ruleEligible } from "../fillConfidence.js";
import { SUPPRESSED_RULE_IDS, type RuleId } from "./ids.js";
import type { RuleContext, RuleResult, Rule } from "./types.js";
import { effectiveCapacityGal } from "./types.js";
import { hoursBetween, daysBetween, milesSinceLast, computedMpg, coldWeatherDeratePct, recentMpgSeries, effectiveBaseline, isOffHours, isFuelVehicle, eventTime, timeReliable, none, r2, median, TANK_FILL_MIN_TOLERANCE_GAL, TANK_FILL_TOLERANCE_PCT } from "./helpers.js";

function ruleOdometerMissing(ctx: RuleContext): RuleResult {
  const { txn, vehicle } = ctx;
  if (txn.odometer == null && txn.gallons > 0) {
    // Higher severity for fuel vehicles — odometer is essential and "leave it blank" is a dodge.
    const severity: AnomalySeverity = isFuelVehicle(vehicle) ? "high" : "medium";
    return { ruleId: "odometer_missing", fired: true, severity, message: "Fill-up recorded without an odometer reading.", evidence: { gallons: txn.gallons } };
  }
  return none("odometer_missing");
}

function ruleOdometerRegression(ctx: RuleContext): RuleResult {
  const { txn, previousTxn } = ctx;
  if (txn.odometer != null && previousTxn?.odometer != null && txn.odometer < previousTxn.odometer) {
    return { ruleId: "odometer_regression", fired: true, severity: "high", message: `Odometer ${txn.odometer} is lower than the previous reading ${previousTxn.odometer}.`, evidence: { previous: previousTxn.odometer, current: txn.odometer } };
  }
  return none("odometer_regression");
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

/** Cross-source odometer reconciliation — the driver-accuracy ±tolerance check (docs/09 §2). */
/** A cross-source odometer diff this large (miles) is not a plausible theft mask — real odometer padding is
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
  if (miles == null || baseline == null || baseline <= 0 || txn.gallons <= 0) return none("expected_odometer_band");
  const expectedMiles = txn.gallons * baseline;
  if (miles > expectedMiles * 2) {
    return { ruleId: "expected_odometer_band", fired: true, severity: "medium", message: `Miles since last (${miles}) far exceed what ${txn.gallons} gal could cover (~${r2(expectedMiles)} mi) — possible odometer over-reporting or a missed fill.`, evidence: { milesSinceLast: miles, gallons: txn.gallons, baselineMpg: r2(baseline), expectedMiles: r2(expectedMiles) } };
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
  if (txn.gallons > expectedConsumed * 1.3 && txn.gallons > 5) {
    return { ruleId: "implausible_topoff", fired: true, severity: "high", message: `Dispensed ${txn.gallons} gal far exceeds the ~${r2(expectedConsumed)} gal consumed since the last fill.`, evidence: { gallons: txn.gallons, milesSinceLast: miles, baselineMpg: r2(baseline), expectedConsumed: r2(expectedConsumed) } };
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
  const mpg = computedMpg(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (mpg == null || baseline == null || baseline <= 0) return none("mpg_deviation");
  // Allow a wider drop in cold months (diesel legitimately loses ~5–10% MPG in severe cold) so winter fills
  // don't false-fire. Derate only widens the band; it never makes the rule fire when it otherwise wouldn't.
  const coldDerate = coldWeatherDeratePct(txn.fueledAt);
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
  const coldDerate = coldWeatherDeratePct(txn.fueledAt);
  const declineFactor = 1 - (10 + coldDerate) / 100;
  if (prior3 > 0 && last3 < prior3 * declineFactor) {
    const coldNote = coldDerate ? ` (allowing +${coldDerate}% for cold-weather economy)` : "";
    return { ruleId: "mpg_sustained_decline", fired: true, severity: "medium", message: `Recent MPG (${r2(last3)}) has declined more than ${10 + coldDerate}% versus the prior period (${r2(prior3)})${coldNote}.`, evidence: { recentMedian: r2(last3), priorMedian: r2(prior3), coldWeatherDeratePct: coldDerate } };
  }
  return none("mpg_sustained_decline");
}

function ruleRapidRepeatFueling(ctx: RuleContext): RuleResult {
  const { txn, previousTxn, thresholds } = ctx;
  if (!previousTxn) return none("rapid_repeat_fueling");
  // BOTH timestamps must be RELIABLE instants — a date-only noon sentinel or an uncorroborated EFS
  // posted time fabricates the interval and false-fires. (txn's own reliability is gated by runAllRules.)
  if (!timeReliable(previousTxn)) return none("rapid_repeat_fueling");
  const hours = hoursBetween(eventTime(previousTxn), eventTime(txn));
  if (hours < thresholds.rapidRefuelHours) {
    return { ruleId: "rapid_repeat_fueling", fired: true, severity: "high", message: `Another fill-up occurred ${r2(hours * 60)} minutes after the previous one.`, evidence: { minutesSincePrev: r2(hours * 60), thresholdHours: thresholds.rapidRefuelHours } };
  }
  return none("rapid_repeat_fueling");
}

function ruleOffHoursFueling(ctx: RuleContext): RuleResult {
  const { txn, operatingHours } = ctx;
  const at = eventTime(txn); // telematics stop time when corroborated — not a possibly-wrong EFS auth time
  if (isOffHours(at, operatingHours)) {
    return { ruleId: "off_hours_fueling", fired: true, severity: "medium", message: `Fueled outside operating hours (${operatingHours.start}–${operatingHours.end} ${operatingHours.tz}).`, evidence: { fueledAt: at, window: `${operatingHours.start}-${operatingHours.end}`, tz: operatingHours.tz } };
  }
  return none("off_hours_fueling");
}

function ruleUnattributed(ctx: RuleContext): RuleResult {
  const { txn } = ctx;
  const missing: string[] = [];
  if (txn.vehicleId == null) missing.push("vehicle");
  if (txn.driverId == null) missing.push("driver");
  if (missing.length) {
    return { ruleId: "unattributed_transaction", fired: true, severity: "high", message: `Transaction is missing ${missing.join(" and ")} attribution.`, evidence: { missing } };
  }
  return none("unattributed_transaction");
}

function ruleCostOutlier(ctx: RuleContext): RuleResult {
  const { txn, thresholds } = ctx;
  const { costMinPerGal: min, costMaxPerGal: max } = thresholds;
  if (txn.pricePerGal == null || (min == null && max == null)) return none("cost_outlier");
  if ((min != null && txn.pricePerGal < min) || (max != null && txn.pricePerGal > max)) {
    return { ruleId: "cost_outlier", fired: true, severity: "low", message: `Price $${txn.pricePerGal}/gal is outside the expected range.`, evidence: { pricePerGal: txn.pricePerGal, min, max } };
  }
  return none("cost_outlier");
}

/**
 * Telematics shows the truck was in a DIFFERENT STATE than the EFS fuel station at the exact fueling
 * time — a high-confidence "card used where the truck isn't" signal. Set only from a precise time +
 * state comparison (docs/10 §11); an unconfirmed/uncertain location is `null` and never fires here.
 */
function ruleLocationMismatch(ctx: RuleContext): RuleResult {
  if (ctx.samsaraLocationMatched === false) {
    return {
      ruleId: "location_mismatch",
      fired: true,
      severity: "high",
      message: "Telematics places the vehicle in a different state than the fuel station at the fueling time.",
      evidence: { samsaraLocationMatched: false, ...(ctx.locationEvidence ?? {}) },
    };
  }
  return none("location_mismatch");
}

/**
 * Telematics tank level rose less than the billed gallons — a soft "less fuel went in than was paid
 * for" signal (possible siphoning / fill into a container). LOW severity by design: Samsara's tank
 * sensor is coarse, so the reconciliation already uses a generous tolerance; this is a corroborator
 * to review, not proof. Only fires on a measured shortfall.
 */
function ruleTankFillShort(ctx: RuleContext): RuleResult {
  // Only fire for trucks whose sensor is LEARNED to reflect the whole fill (observed/billed ≈1). Not-yet-
  // learned or dual-independent-tank trucks (ratio ≈0.5 / erratic) → suppress: a lone sensor on a two-tank
  // truck reads ~half the fill and false-flags every full fill. Reliability gate centralized in ruleEligible
  // (docs/12); gating still means a cheap re-score clears prior false rows without a Samsara re-fetch.
  const short = ctx.tankFillShortGal;
  if (short == null || short <= 0) return none("tank_fill_short");
  // Samsara's tank-% sensor is COARSE, so a small gap between billed gallons and the observed rise is
  // sensor noise, not siphoning. Only flag a shortfall that clears a generous tolerance — the LARGER of an
  // absolute floor or a fraction of the bill. (A few tenths of a gallon off a 168-gal fill must never feed
  // a theft case.) Mirrors reconcileTankFill's defaults; applied HERE so a cheap re-score fixes prior rows.
  const tol = Math.max(TANK_FILL_MIN_TOLERANCE_GAL, ctx.txn.gallons * TANK_FILL_TOLERANCE_PCT);
  if (short <= tol) return none("tank_fill_short");
  const observed = ctx.tankObservedRiseGal;
  return {
    ruleId: "tank_fill_short",
    fired: true,
    severity: "low",
    message: `Telematics tank level rose ~${observed != null ? r2(observed) : "?"} gal, about ${r2(short)} gal less than the ${ctx.txn.gallons} gal billed — beyond the ~${r2(tol)} gal sensor tolerance (coarse sensor — review).`,
    evidence: { gallonsBilled: ctx.txn.gallons, observedRiseGal: observed, shortGal: r2(short), toleranceGal: r2(tol) },
  };
}

/**
 * The reefer tank capacity for a fill — ONLY when it's actually known (a paired, reefer-marked trailer).
 * Returns null when unknown; the reefer rules then do NOT fire, because judging "exceeds capacity" or
 * "over-fueled" against an ASSUMED tank size produces false criticals on legitimate large-reefer fills.
 * (The org threshold default is a UI seed for the Trailers page, never a silent detection assumption.)
 */
function knownReeferTankGal(ctx: RuleContext): number | null {
  return ctx.reeferTankCapacityGal != null && ctx.reeferTankCapacityGal > 0 ? ctx.reeferTankCapacityGal : null;
}

/**
 * A single reefer (ULSR) purchase exceeds the reefer tank capacity — the fuel physically cannot fit in
 * the reefer. The strongest single-transaction sign of gun-switching (billed reefer, pumped into the
 * tractor) or a container fill. Only fires when the reefer tank size is KNOWN (paired reefer trailer).
 */
function ruleReeferExceedsCapacity(ctx: RuleContext): RuleResult {
  const { txn, thresholds } = ctx;
  const cap = knownReeferTankGal(ctx);
  if (cap == null) return none("reefer_exceeds_capacity"); // unknown tank → never accuse on an assumption
  const limit = cap * (1 + thresholds.capacityTolerancePct / 100);
  if (txn.gallons > limit) {
    return { ruleId: "reefer_exceeds_capacity", fired: true, severity: "critical", message: `Reefer fill of ${txn.gallons} gal exceeds the reefer tank capacity (${cap} gal) — the fuel can't fit in the reefer.`, evidence: { gallons: txn.gallons, reeferCapacity: cap, tolerancePct: thresholds.capacityTolerancePct } };
  }
  return none("reefer_exceeds_capacity");
}

/**
 * Rolling window: reefer gallons since the last reefer fill exceed what a reefer unit could physically
 * burn (max burn rate × elapsed hours) plus one full tank. Only fires when the reefer tank size is KNOWN
 * — an assumed tank would mis-size the burnable envelope and false-flag large-reefer trucks.
 */
function ruleReeferOverfuelRate(ctx: RuleContext): RuleResult {
  const { thresholds } = ctx;
  const cap = knownReeferTankGal(ctx);
  if (cap == null) return none("reefer_overfuel_rate");
  const gph = thresholds.maxReeferBurnGph ?? 1.5;
  const hrs = thresholds.cumulativeWindowHours ?? 48;
  const windowGal = ctx.reeferWindowGallons ?? ctx.txn.gallons;
  const maxPlausible = gph * hrs + cap; // could burn at most this in the window, plus a one-tank refill
  if (windowGal > maxPlausible) {
    return { ruleId: "reefer_overfuel_rate", fired: true, severity: "high", message: `Reefer bought ${r2(windowGal)} gal in ${hrs}h — more than a reefer could burn (${gph} gal/h ≈ ${r2(gph * hrs)} gal) plus a full ${cap}-gal tank.`, evidence: { reeferWindowGallons: r2(windowGal), maxBurnGph: gph, windowHours: hrs, reeferCapacity: cap, maxPlausibleGal: r2(maxPlausible) } };
  }
  return none("reefer_overfuel_rate");
}

/**
 * Reefer fueled with ULSD (diversion). A tractor (ULSD) fill on a truck that HAULS a reefer (paired is_reefer
 * trailer) while the truck bought little/no reefer (ULSR) fuel over the window — the classic "select Ultra Low
 * Sulfur, then move the gun to the reefer" pattern. Guarded to stay assumption-free:
 *   • only fires when the ORG actually uses a reefer (ULSR) product code (else "no ULSR" is not informative);
 *   • only when the truck is ACTIVE (bought real ULSD in the window — a parked/deadhead reefer needs no fuel);
 *   • only when reefer purchases are at/below the deficiency floor (default 0 → bought none).
 * Review on its own; escalates to an alert when the same fill also fires tank_fill_short (the ULSD physically
 * did not all enter the tractor tank — where did it go?), because the reefer + volume axes then agree.
 */
function ruleReeferFuelDiversion(ctx: RuleContext): RuleResult {
  const { txn, thresholds } = ctx;
  if (txn.tankType === "reefer") return none("reefer_fuel_diversion"); // rule is about ULSD (tractor) fills
  if (!ctx.reeferPaired) return none("reefer_fuel_diversion"); // truck must actually haul a reefer
  if (!ctx.orgUsesReeferFuel) return none("reefer_fuel_diversion"); // fleet must track reefer fuel separately
  const winTractor = ctx.reeferDiversionTractorGal ?? 0;
  const winReefer = ctx.reeferDiversionReeferGal ?? 0;
  const minTractor = thresholds.reeferDiversionMinTractorGal ?? 150;
  const maxReefer = thresholds.reeferDiversionMaxReeferGal ?? 0;
  const days = thresholds.reeferDiversionWindowDays ?? 30;
  if (winTractor < minTractor) return none("reefer_fuel_diversion"); // not enough activity to expect reefer fuel
  if (winReefer > maxReefer) return none("reefer_fuel_diversion"); // reefer IS being fueled → nothing to flag
  // TMS (McLeod) gate (see RuleContext.reeferLoadInWindow): no reefer load pulled → reefer never ran → suppress.
  if (ctx.reeferLoadInWindow === false) return none("reefer_fuel_diversion");
  return {
    ruleId: "reefer_fuel_diversion",
    fired: true,
    severity: "medium",
    message: `This truck hauls a reefer but bought ${winReefer <= 0 ? "no" : `only ${r2(winReefer)} gal of`} reefer (ULSR) fuel in ${days} days while buying ${r2(winTractor)} gal of ULSD — the reefer may be fueled off ULSD selected at the pump.`,
    evidence: { reeferGalInWindow: r2(winReefer), tractorGalInWindow: r2(winTractor), windowDays: days, minTractorGal: minTractor, maxReeferGal: maxReefer, reeferLoadInWindow: ctx.reeferLoadInWindow ?? null },
  };
}

/** One fuel card used across multiple vehicles in the window — classic card-sharing / misuse signal. */
function ruleCardMultiVehicle(ctx: RuleContext): RuleResult {
  const count = ctx.cardVehicleCountInWindow ?? 0;
  if (ctx.txn.cardRef && count >= 2) {
    const hrs = ctx.thresholds.cumulativeWindowHours ?? 48;
    return { ruleId: "card_multi_vehicle", fired: true, severity: "high", message: `This fuel card fueled ${count} different vehicles within ${hrs}h.`, evidence: { vehicleCount: count, windowHours: hrs } };
  }
  return none("card_multi_vehicle");
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
    timeOk && prevTimeOk ? ruleOdometerImplausibleJump : ruleOdometerDailyCap,
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
  // P-1: when the entered odometer disagrees with the trusted OBD reading (a mismatch, or a data-quality
  // entry-suspect), the per-fill miles derived FROM that entered odometer are untrustworthy. Suppress the
  // miles-based per-fill rules so one bad odometer entry can't stack odometer + consumption + volume signals
  // into a false theft case. Gross overfuel is still caught by cumulative_overfuel (clean OBD-span window)
  // and by the tank rules.
  if (results.some((r) => r.ruleId === "odometer_mismatch" || r.ruleId === "odometer_entry_suspect")) {
    const milesDerived = new Set<RuleId>(["mpg_deviation", "implausible_topoff", "expected_odometer_band"]);
    results = results.filter((r) => !milesDerived.has(r.ruleId));
  }
  return results;
}

