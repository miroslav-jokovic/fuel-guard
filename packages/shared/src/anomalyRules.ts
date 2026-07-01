/**
 * FuelGuard anomaly engine — deterministic, explainable rules (docs/02-DATA-MODEL.md §7 + §10.7–8,
 * hardened per docs/09-DETECTION-REVIEW.md). Pure functions only: the API assembles the context,
 * runs `runAllRules`, and persists the results. All quantitative math happens here (not in the AI).
 */
import { MPG_FUEL_TYPES, type AnomalySeverity, type FuelType } from "./constants.js";

export const RULE_IDS = [
  // Tier 1 — odometer integrity
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump", // instant-precision only (uses elapsed hours)
  "odometer_daily_cap", // date-precision (EFS) fallback (miles/day cap)
  "odometer_mismatch", // cross-source ±tolerance reconciliation (the driver-accuracy check)
  "expected_odometer_band", // single-source: miles vs fuel-implied miles
  // Tier 2 — volume vs capacity
  "exceeds_tank_capacity",
  "implausible_topoff",
  "cumulative_overfuel", // rolling-window gallons vs miles-burnable + a tank
  // Tier 3 — efficiency
  "mpg_deviation",
  "mpg_sustained_decline",
  // Tier 4 — behavioral
  "rapid_repeat_fueling", // instant-precision only
  "off_hours_fueling", // instant-precision only
  "unattributed_transaction",
  "cost_outlier",
  "card_multi_vehicle", // one card fueling multiple vehicles in a window
  "location_mismatch", // telematics shows the truck was NOT at the fueling location
  "tank_fill_short", // telematics tank rose less than billed gallons (advisory; coarse sensor)
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** Human-readable label for every rule ID. Used wherever the raw snake_case key would be shown. */
export const RULE_LABELS: Record<RuleId, string> = {
  odometer_missing:           "Missing Odometer",
  odometer_regression:        "Odometer Regression",
  odometer_stale:             "Stale Odometer",
  odometer_implausible_jump:  "Implausible Odometer Jump",
  odometer_daily_cap:         "Daily Mileage Cap Exceeded",
  odometer_mismatch:          "Odometer / Location Mismatch",
  expected_odometer_band:     "Outside Expected Odometer Band",
  exceeds_tank_capacity:      "Exceeds Tank Capacity",
  implausible_topoff:         "Implausible Top-Off",
  cumulative_overfuel:        "Cumulative Overfueling",
  mpg_deviation:              "MPG Deviation",
  mpg_sustained_decline:      "Sustained MPG Decline",
  rapid_repeat_fueling:       "Rapid Repeat Fueling",
  off_hours_fueling:          "Off-Hours Fueling",
  unattributed_transaction:   "Unattributed Transaction",
  cost_outlier:               "Cost Outlier",
  card_multi_vehicle:         "Card Used on Multiple Vehicles",
  location_mismatch:          "Location Mismatch",
  tank_fill_short:            "Tank Fill Short",
};

/** Returns the human-friendly label for a rule ID, with a sensible fallback for unknown IDs. */
export function formatRuleId(ruleId: string): string {
  return (RULE_LABELS as Record<string, string>)[ruleId]
    ?? ruleId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type FueledAtPrecision = "instant" | "date";

export interface TxnView {
  id: string;
  vehicleId: string | null;
  driverId: string | null;
  fueledAt: string; // ISO-8601 instant
  odometer: number | null;
  gallons: number;
  pricePerGal: number | null;
  totalCost: number | null;
  /** 'date' for EFS imports (no time-of-day) → time-based rules are suppressed. Default 'instant'. */
  fueledAtPrecision?: FueledAtPrecision;
  cardRef?: string | null;
}

export interface VehicleView {
  id: string;
  fuelType: FuelType;
  tankCapacityGal: number;
  baselineMpg: number | null;
}

export interface Thresholds {
  mpgDropPct: number;
  capacityTolerancePct: number;
  rapidRefuelHours: number;
  maxPlausibleMph: number;
  costMinPerGal: number | null;
  costMaxPerGal: number | null;
  disabledRules: RuleId[];
  /** Cross-source odometer tolerance in miles (the ±5 check). Default 5. */
  odometerToleranceMiles?: number;
  /** Max plausible miles/day for date-precision data. Default 1000. */
  maxDailyMiles?: number;
  /** Rolling window (hours) for cumulative-overfuel and card-multi-vehicle. Default 48. */
  cumulativeWindowHours?: number;
}

export interface OperatingHours {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  tz: string; // IANA tz
}

export interface RuleContext {
  txn: TxnView;
  vehicle: VehicleView;
  /** Immediately preceding fill (max fueledAt < txn.fueledAt, same vehicle). Null for first fill. */
  previousTxn: TxnView | null;
  /** Up to the last ~6 VALID fills before txn (odometer-anomalous excluded), OLDEST→NEWEST. */
  recentTxns: TxnView[];
  thresholds: Thresholds;
  operatingHours: OperatingHours;
  /** Odometer from the *other* source (manual↔EFS) for the same fueling event, if matched. */
  crossSourceOdometer?: number | null;
  /** Sum of gallons for this vehicle within the cumulative window (incl. this txn). */
  windowGallons?: number;
  /** Odometer span (max−min) for this vehicle within the cumulative window, if computable. */
  windowMiles?: number | null;
  /** Distinct vehicles seen on this txn's card within the window (incl. this one). */
  cardVehicleCountInWindow?: number;
  /** From Samsara reconciliation: was the truck actually at the EFS station's location? null = unknown. */
  samsaraLocationMatched?: boolean | null;
  /** Gallons the billed amount exceeded the observed Samsara tank rise by (coarse sensor). null = not measured. */
  tankFillShortGal?: number | null;
  /** Gallons the tank actually rose across the fueling moment (Samsara). */
  tankObservedRiseGal?: number | null;
}

export interface RuleResult {
  ruleId: RuleId;
  fired: boolean;
  severity: AnomalySeverity;
  message: string;
  evidence: Record<string, unknown>;
}

export type Rule = (ctx: RuleContext) => RuleResult;

// ── helpers ───────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

export function hoursBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(bIso).getTime() - new Date(aIso).getTime()) / 3_600_000;
}

export function daysBetween(aIso: string, bIso: string): number {
  return hoursBetween(aIso, bIso) / 24;
}

export function milesSinceLast(txn: TxnView, prev: TxnView | null): number | null {
  if (!prev || txn.odometer == null || prev.odometer == null) return null;
  const d = txn.odometer - prev.odometer;
  return d > 0 ? d : null;
}

export function computedMpg(txn: TxnView, prev: TxnView | null): number | null {
  const miles = milesSinceLast(txn, prev);
  if (miles == null || txn.gallons <= 0) return null;
  return r2(miles / txn.gallons);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function recentMpgSeries(ordered: TxnView[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const mpg = computedMpg(ordered[i]!, ordered[i - 1]!);
    if (mpg != null) out.push(mpg);
  }
  return out;
}

export function effectiveBaseline(vehicle: VehicleView, recentTxns: TxnView[]): number | null {
  const series = recentMpgSeries(recentTxns);
  if (series.length >= 3) return r2(median(series.slice(-5)));
  return vehicle.baselineMpg ?? null;
}

export function localHourMinute(iso: string, tz: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { h, m };
}

export function isOffHours(iso: string, oh: OperatingHours): boolean {
  const { h, m } = localHourMinute(iso, oh.tz);
  const cur = h * 60 + m;
  const [sh, sm] = oh.start.split(":").map(Number);
  const [eh, em] = oh.end.split(":").map(Number);
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  const end = (eh ?? 0) * 60 + (em ?? 0);
  return start <= end ? cur < start || cur >= end : cur < start && cur >= end;
}

const isFuelVehicle = (v: VehicleView) => MPG_FUEL_TYPES.includes(v.fuelType);
const precision = (t: TxnView): FueledAtPrecision => t.fueledAtPrecision ?? "instant";

// ── the rules ─────────────────────────────────────────────────────────────────

const none = (ruleId: RuleId): RuleResult => ({ ruleId, fired: false, severity: "low", message: "", evidence: {} });

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
function ruleOdometerMismatch(ctx: RuleContext): RuleResult {
  const { txn, crossSourceOdometer, thresholds } = ctx;
  if (txn.odometer == null || crossSourceOdometer == null) return none("odometer_mismatch");
  const tol = thresholds.odometerToleranceMiles ?? 5;
  const diff = Math.abs(txn.odometer - crossSourceOdometer);
  if (diff > tol) {
    return { ruleId: "odometer_mismatch", fired: true, severity: "high", message: `Entered odometer ${txn.odometer} differs from the fuel-card reading ${crossSourceOdometer} by ${r2(diff)} mi (tolerance ${tol}).`, evidence: { entered: txn.odometer, otherSource: crossSourceOdometer, diff: r2(diff), toleranceMiles: tol } };
  }
  return none("odometer_mismatch");
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
  const limit = vehicle.tankCapacityGal * (1 + thresholds.capacityTolerancePct / 100);
  if (vehicle.tankCapacityGal > 0 && txn.gallons > limit) {
    return { ruleId: "exceeds_tank_capacity", fired: true, severity: "critical", message: `Dispensed ${txn.gallons} gal exceeds the ${vehicle.tankCapacityGal} gal tank — fuel cannot fit.`, evidence: { gallons: txn.gallons, capacity: vehicle.tankCapacityGal, tolerancePct: thresholds.capacityTolerancePct } };
  }
  return none("exceeds_tank_capacity");
}

function ruleImplausibleTopoff(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns } = ctx;
  const miles = milesSinceLast(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns); // rolling, not static seed
  if (miles == null || baseline == null || baseline <= 0) return none("implausible_topoff");
  const expectedConsumed = miles / baseline;
  if (txn.gallons > expectedConsumed * 1.3 && txn.gallons > 5) {
    return { ruleId: "implausible_topoff", fired: true, severity: "high", message: `Dispensed ${txn.gallons} gal far exceeds the ~${r2(expectedConsumed)} gal consumed since the last fill.`, evidence: { gallons: txn.gallons, milesSinceLast: miles, baselineMpg: r2(baseline), expectedConsumed: r2(expectedConsumed) } };
  }
  return none("implausible_topoff");
}

/** Rolling-window reconciliation: fuel purchased can't exceed fuel burnable in the window + one tank. */
function ruleCumulativeOverfuel(ctx: RuleContext): RuleResult {
  const { vehicle, recentTxns, thresholds } = ctx;
  const windowGallons = ctx.windowGallons ?? 0;
  const windowMiles = ctx.windowMiles ?? null;
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (windowGallons <= 0 || baseline == null || baseline <= 0 || windowMiles == null) return none("cumulative_overfuel");
  const burnable = windowMiles / baseline;
  const ceiling = burnable + vehicle.tankCapacityGal; // could burn this much + arrive with an empty tank
  if (windowGallons > ceiling) {
    const hrs = thresholds.cumulativeWindowHours ?? 48;
    return { ruleId: "cumulative_overfuel", fired: true, severity: "high", message: `Purchased ${r2(windowGallons)} gal in ${hrs}h but could burn only ~${r2(burnable)} gal over ${windowMiles} mi (+${vehicle.tankCapacityGal} gal tank).`, evidence: { windowGallons: r2(windowGallons), windowMiles, burnable: r2(burnable), tankCapacity: vehicle.tankCapacityGal, windowHours: hrs } };
  }
  return none("cumulative_overfuel");
}

function ruleMpgDeviation(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns, thresholds } = ctx;
  const mpg = computedMpg(txn, previousTxn);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (mpg == null || baseline == null || baseline <= 0) return none("mpg_deviation");
  const floor = baseline * (1 - thresholds.mpgDropPct / 100);
  if (mpg < floor) {
    return { ruleId: "mpg_deviation", fired: true, severity: "high", message: `MPG ${mpg} is ${r2(((baseline - mpg) / baseline) * 100)}% below the baseline ${r2(baseline)}.`, evidence: { computedMpg: mpg, baselineMpg: r2(baseline), dropPct: thresholds.mpgDropPct } };
  }
  return none("mpg_deviation");
}

function ruleMpgSustainedDecline(ctx: RuleContext): RuleResult {
  const { txn, recentTxns } = ctx;
  const series = recentMpgSeries([...recentTxns, txn]);
  if (series.length < 6) return none("mpg_sustained_decline");
  const last3 = median(series.slice(-3));
  const prior3 = median(series.slice(-6, -3));
  if (prior3 > 0 && last3 < prior3 * 0.9) {
    return { ruleId: "mpg_sustained_decline", fired: true, severity: "medium", message: `Recent MPG (${r2(last3)}) has declined more than 10% versus the prior period (${r2(prior3)}).`, evidence: { recentMedian: r2(last3), priorMedian: r2(prior3) } };
  }
  return none("mpg_sustained_decline");
}

function ruleRapidRepeatFueling(ctx: RuleContext): RuleResult {
  const { txn, previousTxn, thresholds } = ctx;
  if (!previousTxn) return none("rapid_repeat_fueling");
  const hours = hoursBetween(previousTxn.fueledAt, txn.fueledAt);
  if (hours < thresholds.rapidRefuelHours) {
    return { ruleId: "rapid_repeat_fueling", fired: true, severity: "high", message: `Another fill-up occurred ${r2(hours * 60)} minutes after the previous one.`, evidence: { minutesSincePrev: r2(hours * 60), thresholdHours: thresholds.rapidRefuelHours } };
  }
  return none("rapid_repeat_fueling");
}

function ruleOffHoursFueling(ctx: RuleContext): RuleResult {
  const { txn, operatingHours } = ctx;
  if (isOffHours(txn.fueledAt, operatingHours)) {
    return { ruleId: "off_hours_fueling", fired: true, severity: "medium", message: `Fueled outside operating hours (${operatingHours.start}–${operatingHours.end} ${operatingHours.tz}).`, evidence: { fueledAt: txn.fueledAt, window: `${operatingHours.start}-${operatingHours.end}`, tz: operatingHours.tz } };
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

/** Telematics says the truck was NOT at the fueling location — a strong card-misuse / theft signal. */
function ruleLocationMismatch(ctx: RuleContext): RuleResult {
  if (ctx.samsaraLocationMatched === false) {
    return {
      ruleId: "location_mismatch",
      fired: true,
      severity: "high",
      message: "Telematics shows the vehicle was not at the fueling location when the card was used.",
      evidence: { samsaraLocationMatched: false },
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
  const short = ctx.tankFillShortGal;
  if (short != null && short > 0) {
    const observed = ctx.tankObservedRiseGal;
    return {
      ruleId: "tank_fill_short",
      fired: true,
      severity: "low",
      message: `Telematics tank level rose ~${observed != null ? r2(observed) : "?"} gal, about ${r2(short)} gal less than the ${ctx.txn.gallons} gal billed (coarse sensor — review).`,
      evidence: { gallonsBilled: ctx.txn.gallons, observedRiseGal: observed, shortGal: r2(short) },
    };
  }
  return none("tank_fill_short");
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
  const fuel = isFuelVehicle(ctx.vehicle);
  const instant = precision(ctx.txn) === "instant";

  const rules: Rule[] = [
    // Tier 1 — odometer
    ruleOdometerMissing,
    ruleOdometerRegression,
    ruleOdometerStale,
    instant ? ruleOdometerImplausibleJump : ruleOdometerDailyCap,
    ruleOdometerMismatch,
    ...(fuel ? [ruleExpectedOdometerBand] : []),
    // Tier 2 — capacity (fuel vehicles only)
    ...(fuel ? [ruleExceedsTankCapacity, ruleImplausibleTopoff, ruleCumulativeOverfuel] : []),
    // Tier 3 — efficiency (fuel vehicles only)
    ...(fuel ? [ruleMpgDeviation, ruleMpgSustainedDecline] : []),
    // Tier 4 — behavioral
    ...(instant ? [ruleRapidRepeatFueling, ruleOffHoursFueling] : []),
    ruleUnattributed,
    ruleCostOutlier,
    ruleCardMultiVehicle,
    ruleLocationMismatch,
    ...(fuel ? [ruleTankFillShort] : []),
  ];

  let results = rules.map((rule) => rule(ctx)).filter((r) => r.fired && !disabled.has(r.ruleId));

  // Precedence: an over-capacity fill makes the per-fill top-off rule redundant.
  if (results.some((r) => r.ruleId === "exceeds_tank_capacity")) {
    results = results.filter((r) => r.ruleId !== "implausible_topoff");
  }
  return results;
}

export const SEVERITY_RANK: Record<AnomalySeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function maxSeverity(results: RuleResult[]): AnomalySeverity | null {
  if (results.length === 0) return null;
  return results.reduce((a, r) => (SEVERITY_RANK[r.severity] > SEVERITY_RANK[a] ? r.severity : a), "low" as AnomalySeverity);
}

// ── anomaly reconciliation (audit M5: never wipe workflow state) ────────────────

export interface ExistingAnomaly {
  id: string;
  rule_id: string;
  status: string;
  source: string;
}

export interface AnomalyReconciliation {
  toInsert: RuleResult[];
  toSupersedeIds: string[];
}

export function reconcileAnomalies(
  existing: ExistingAnomaly[],
  fired: RuleResult[],
): AnomalyReconciliation {
  const active = existing.filter((a) => a.status !== "superseded");
  const activeRuleIds = new Set<string>(active.map((a) => a.rule_id));
  const firedRuleIds = new Set<string>(fired.map((f) => f.ruleId));

  const toInsert = fired.filter((f) => !activeRuleIds.has(f.ruleId));
  const toSupersedeIds = existing
    .filter((a) => a.source === "rules" && a.status === "open" && !firedRuleIds.has(a.rule_id))
    .map((a) => a.id);

  return { toInsert, toSupersedeIds };
}
