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
  "tank_space_exceeded", // billed gallons > empty space in the tank before fueling (can't fit in THIS truck)
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
  // Tier A — reefer (trailer refrigeration) fuel integrity (reefer/ULSR events only)
  "reefer_exceeds_capacity", // one ULSR purchase > reefer tank capacity — can't fit in the reefer
  "reefer_overfuel_rate", // rolling-window reefer gallons > a reefer could burn + a tank
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/**
 * Data-quality flags, NOT theft/misuse signals. These describe gaps in the source data (a fill that
 * couldn't be matched to a vehicle/driver, or a blank odometer) rather than suspicious behavior.
 * Flagging them as anomalies drowns the real signals, so by product decision they never raise an
 * anomaly. The underlying facts stay visible on the transaction itself (e.g. "Unattributed" in the
 * fuel log). Re-enable a rule by removing it here.
 */
export const SUPPRESSED_RULE_IDS: readonly RuleId[] = [
  "unattributed_transaction",
  "odometer_missing",
] as const;

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
  tank_space_exceeded:        "More Fuel Than Tank Could Hold",
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
  reefer_exceeds_capacity:    "Reefer Fill Exceeds Tank",
  reefer_overfuel_rate:       "Reefer Over-Fueling",
};

/** Returns the human-friendly label for a rule ID, with a sensible fallback for unknown IDs. */
export function formatRuleId(ruleId: string): string {
  if (ruleId === "theft_case") return "Theft Risk";
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
  /**
   * The instant time-of-day and inter-fill rules should use — the telematics-recovered stop time when we
   * corroborated it, which corrects EFS authorization/settlement timestamps that differ from the real pump
   * time. `fueledAt` stays the business timestamp (day bucketing / dedup); this is separate. Defaults to
   * `fueledAt`.
   */
  eventAt?: string | null;
  /**
   * Whether we trust the fueling INSTANT (not the day). true = corroborated by a telematics stop or a
   * manual entry; false = an uncorroborated EFS posted time (may be an auth/settlement time). When false,
   * time-of-day and inter-fill timing rules are suppressed rather than fired off a possibly-wrong clock.
   * Undefined = treat as trusted (back-compat).
   */
  timeConfirmed?: boolean;
  /** Which tank this fill filled. 'reefer' events skip the tractor volume/consumption/tank rules
   *  (those compare against the tractor's tank + MPG). Default 'tractor'. */
  tankType?: "tractor" | "reefer";
  cardRef?: string | null;
}

export interface VehicleView {
  id: string;
  fuelType: FuelType;
  tankCapacityGal: number;
  baselineMpg: number | null;
  /** Learned/overridden constant (dash − Samsara). Added to the Samsara reading before the mismatch check. */
  odometerOffset?: number;
}

export interface Thresholds {
  mpgDropPct: number;
  capacityTolerancePct: number;
  rapidRefuelHours: number;
  maxPlausibleMph: number;
  costMinPerGal: number | null;
  costMaxPerGal: number | null;
  disabledRules: RuleId[];
  /** Cross-source odometer tolerance in miles (entered vs Samsara at the fill). Default 10 (migration 0026). */
  odometerToleranceMiles?: number;
  /** Max plausible miles/day for date-precision data. Default 1000. */
  maxDailyMiles?: number;
  /** Rolling window (hours) for cumulative-overfuel and card-multi-vehicle. Default 48. */
  cumulativeWindowHours?: number;
  /** Max gallons/hour a reefer unit can plausibly burn (continuous, deep-frozen). Default 1.5. */
  maxReeferBurnGph?: number;
  /** Reefer tank capacity to assume when a fill's trailer is unknown/unpaired. Default 50. */
  reeferTankDefaultGal?: number;
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
  /** Provenance of `crossSourceOdometer`: 'obd' (ECU — matches the dash/EFS odometer), 'gps' (Samsara
   *  GPS-derived — a large, per-truck-varying bias), or 'reconstructed'. Only 'obd' is trustworthy for an
   *  absolute ±tolerance mismatch; GPS/reconstructed carry biases a single per-truck offset can't absorb. */
  crossSourceOdometerSource?: string | null;
  /** Sum of gallons for this vehicle within the cumulative window (incl. this txn). */
  windowGallons?: number;
  /** Odometer span (max−min) for this vehicle within the cumulative window, if computable. */
  windowMiles?: number | null;
  /** Distinct vehicles seen on this txn's card within the window (incl. this one). */
  cardVehicleCountInWindow?: number;
  /** From Samsara reconciliation: was the truck actually at the EFS station's location? null = unknown. */
  samsaraLocationMatched?: boolean | null;
  /** Evidence for a location mismatch (EFS vs Samsara city/state at the fueling time). */
  locationEvidence?: Record<string, unknown> | null;
  /** Gallons the billed amount exceeded the observed Samsara tank rise by (coarse sensor). null = not measured. */
  tankFillShortGal?: number | null;
  /** Gallons the tank actually rose across the fueling moment (Samsara). */
  tankObservedRiseGal?: number | null;
  /** Samsara tank level (%) just BEFORE the fill — used for the physical tank-space check. */
  tankPctBefore?: number | null;
  /** For a REEFER fill: the paired trailer's reefer tank capacity (gal); null → use the threshold default. */
  reeferTankCapacityGal?: number | null;
  /** For a REEFER fill: sum of reefer gallons for this vehicle within the cumulative window (incl. this txn). */
  reeferWindowGallons?: number;
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

/**
 * Sensor tolerance for the advisory tank-fill-short check. Samsara's OBD tank-% reading is coarse, so a
 * billed-vs-observed gap under the LARGER of {floor gal, pct of the bill} is treated as noise, not a
 * shortfall. Mirrors reconcileTankFill's defaults. Exposed so it's discoverable and tunable in one place.
 */
export const TANK_FILL_MIN_TOLERANCE_GAL = 15;
export const TANK_FILL_TOLERANCE_PCT = 0.3;

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
/** The instant to use for time-of-day / interval math — the telematics-recovered stop time when present. */
const eventTime = (t: TxnView): string => t.eventAt ?? t.fueledAt;
/** True when the fueling INSTANT is trustworthy: a real time-of-day AND corroborated (or manual). A
 *  date-only sentinel or an uncorroborated EFS posted time (timeConfirmed===false) is not reliable. */
const timeReliable = (t: TxnView): boolean => precision(t) === "instant" && t.timeConfirmed !== false;

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
  const { txn, crossSourceOdometer, crossSourceOdometerSource, thresholds, vehicle } = ctx;
  if (txn.odometer == null || crossSourceOdometer == null) return none("odometer_mismatch");
  // Only the ECU/OBD odometer matches the dash the driver reads off (and the EFS entry) closely enough for
  // an absolute ±tolerance check. Samsara's GPS-derived odometer carries a large, per-truck-varying bias,
  // and a single learned offset can't absorb a MIX of OBD and GPS readings across a truck's fills — so
  // comparing it produced false mismatches. Use it for display/coverage only; never flag on it.
  if (crossSourceOdometerSource != null && crossSourceOdometerSource !== "obd") return none("odometer_mismatch");
  const tol = thresholds.odometerToleranceMiles ?? 10;
  // Many trucks read a fixed amount apart from Samsara's OBD odometer (replaced cluster, OBD calibration).
  // Apply the learned/overridden per-vehicle offset so that constant gap doesn't false-flag every fill —
  // while a fill that deviates from the established offset by more than the tolerance still fires.
  const offset = vehicle.odometerOffset ?? 0;
  const expected = crossSourceOdometer + offset;
  const diff = Math.abs(txn.odometer - expected);
  if (diff > tol) {
    const offsetNote = offset ? ` (after a learned +${r2(offset)} mi calibration)` : "";
    return { ruleId: "odometer_mismatch", fired: true, severity: "high", message: `Entered odometer ${txn.odometer} differs from the fuel-card reading ${crossSourceOdometer}${offsetNote} by ${r2(diff)} mi (tolerance ${tol}).`, evidence: { entered: txn.odometer, otherSource: crossSourceOdometer, offset: r2(offset), expected: r2(expected), diff: r2(diff), toleranceMiles: tol } };
  }
  return none("odometer_mismatch");
}

export interface OdometerOffsetResult {
  /** Learned constant (entered − samsara), rounded to whole miles. */
  offset: number;
  /** How many (entered, samsara) pairs backed the estimate. */
  samples: number;
}

/**
 * Learn a per-vehicle odometer offset (dash − Samsara) from recent fills that have BOTH readings. Uses the
 * median (robust to the occasional bad entry) over the most recent `window` pairs, and only returns a value
 * when there are ≥ `minSamples` pairs AND they cluster tightly (a solid majority within `clusterToleranceMiles`
 * of the median). Otherwise returns null — meaning "not enough evidence", leave the offset at 0.
 */
export function learnOdometerOffset(
  pairs: { entered: number; samsara: number }[],
  opts: { window?: number; clusterToleranceMiles?: number; minSamples?: number } = {},
): OdometerOffsetResult | null {
  const window = opts.window ?? 10;
  const tol = opts.clusterToleranceMiles ?? 3;
  const minSamples = opts.minSamples ?? 3;
  const diffs = pairs
    .filter((p) => Number.isFinite(p.entered) && Number.isFinite(p.samsara))
    .slice(-window)
    .map((p) => p.entered - p.samsara);
  if (diffs.length < minSamples) return null;
  const med = median(diffs);
  const within = diffs.filter((d) => Math.abs(d - med) <= tol).length;
  // Require both an absolute floor of clustered samples and a clustered majority.
  if (within < minSamples || within / diffs.length < 0.6) return null;
  return { offset: Math.round(med), samples: diffs.length };
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

/**
 * PHYSICAL tank-space check (the automated version of "he can't put in more than the tank holds"):
 * before fueling the tank was at P% of a C-gallon tank, so only C·(1−P/100) gallons of empty space
 * existed. If the card billed materially MORE than that space, the excess fuel could not have gone into
 * this truck — it went somewhere else. Uses only the reliable PRE-fill level (not the noisy post-fill
 * plateau). Tolerance absorbs sensor coarseness. Silent (never fires) when level/capacity are missing.
 */
function ruleTankSpaceExceeded(ctx: RuleContext): RuleResult {
  const { txn, vehicle, tankPctBefore } = ctx;
  const cap = vehicle.tankCapacityGal;
  if (tankPctBefore == null || cap <= 0 || txn.gallons <= 0) return none("tank_space_exceeded");
  const freeSpace = cap * (1 - Math.min(Math.max(tankPctBefore, 0), 100) / 100);
  // Tolerance for sensor coarseness: the larger of 12 gal or 10% of the tank.
  const tol = Math.max(12, cap * 0.1);
  const over = txn.gallons - freeSpace;
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
    // Tier A — reefer rules run ONLY on reefer (ULSR) fills (tractor rules were gated off for them).
    ...(ctx.txn.tankType === "reefer" ? [ruleReeferExceedsCapacity, ruleReeferOverfuelRate] : []),
  ];

  const suppressed = new Set<RuleId>(SUPPRESSED_RULE_IDS);
  let results = rules
    .map((rule) => rule(ctx))
    .filter((r) => r.fired && !disabled.has(r.ruleId) && !suppressed.has(r.ruleId));

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

// ── multi-signal correlation (docs/09 §theft-model) ─────────────────────────────
// A single fired rule is a SIGNAL, not a verdict. Theft is caught reliably when INDEPENDENT signals
// agree (truck-not-there + more-fuel-than-fits, etc.). Each signal has an evidence "axis" and a weight
// (0–100) for how directly it implies theft. We correlate ACROSS axes so a lone weak signal (e.g. an
// odometer that's a few miles off) never raises a red alert — it stays clear or, if strong on its own,
// a review. This is what keeps normal fills from all looking flagged.

export type SignalAxis = "location" | "volume" | "consumption" | "odometer" | "behavior" | "reefer";

/** The single synthetic anomaly id used for a correlated per-transaction case. */
export const CASE_RULE_ID = "theft_case";

export const SIGNAL_META: Record<RuleId, { axis: SignalAxis; weight: number }> = {
  // Volume — fuel physically not going into this truck (the hardest to game)
  tank_space_exceeded:        { axis: "volume", weight: 90 },
  exceeds_tank_capacity:      { axis: "volume", weight: 85 },
  tank_fill_short:            { axis: "volume", weight: 60 },
  implausible_topoff:         { axis: "volume", weight: 50 },
  // Consumption — buying more than the truck could burn
  cumulative_overfuel:        { axis: "consumption", weight: 75 },
  expected_odometer_band:     { axis: "consumption", weight: 40 },
  mpg_deviation:              { axis: "consumption", weight: 30 },
  mpg_sustained_decline:      { axis: "consumption", weight: 20 },
  // Location — card used where the truck isn't. Corroboration-only (weight below the lone-review
  // threshold): telematics location is the least-reliable signal, so it never raises a case on its own,
  // but it strongly reinforces a case when a volume/consumption signal also fires.
  location_mismatch:          { axis: "location", weight: 50 },
  // Odometer — driver misreporting (masks theft / owner's accuracy concern)
  odometer_regression:        { axis: "odometer", weight: 55 },
  odometer_mismatch:          { axis: "odometer", weight: 45 },
  odometer_implausible_jump:  { axis: "odometer", weight: 35 },
  odometer_daily_cap:         { axis: "odometer", weight: 30 },
  odometer_stale:             { axis: "odometer", weight: 25 },
  odometer_missing:           { axis: "odometer", weight: 0 },
  // Behavior — card / timing patterns
  card_multi_vehicle:         { axis: "behavior", weight: 60 },
  rapid_repeat_fueling:       { axis: "behavior", weight: 40 },
  off_hours_fueling:          { axis: "behavior", weight: 20 },
  cost_outlier:               { axis: "behavior", weight: 15 },
  unattributed_transaction:   { axis: "behavior", weight: 0 },
  // Reefer — ULSR fuel not going into the reefer tank (gun-switch / container fill)
  reefer_exceeds_capacity:    { axis: "reefer", weight: 90 },
  reefer_overfuel_rate:       { axis: "reefer", weight: 75 },
};

/** A signal ≥ this weight is "overwhelming" and raises an alert on its own (e.g. more fuel than fits). */
const OVERWHELMING_WEIGHT = 85;
/** A single signal ≥ this weight is worth a review on its own. */
const REVIEW_WEIGHT = 60;
/** Correlated alert: ≥2 independent axes and combined score ≥ this. */
const ALERT_SCORE = 110;

export type CaseLevel = "clear" | "review" | "alert";

export interface CaseSignal {
  ruleId: RuleId;
  axis: SignalAxis;
  weight: number;
  severity: AnomalySeverity;
  message: string;
}

export interface CaseAssessment {
  level: CaseLevel;
  /** null when clear; otherwise the case severity for the single anomaly row. */
  severity: AnomalySeverity | null;
  score: number;
  axes: SignalAxis[];
  signals: CaseSignal[];
  summary: string;
}

/**
 * Correlate the fired signals into ONE per-transaction case. Weak lone signals → clear (no anomaly);
 * a single strong signal → review; independent corroborating signals (or one overwhelming one) → alert.
 */
export function correlateSignals(fired: RuleResult[]): CaseAssessment {
  const signals: CaseSignal[] = fired
    .map((f) => ({ ruleId: f.ruleId, ...SIGNAL_META[f.ruleId], severity: f.severity, message: f.message }))
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  if (signals.length === 0) {
    return { level: "clear", severity: null, score: 0, axes: [], signals: [], summary: "" };
  }

  // Score = sum of the STRONGEST signal per axis (don't double-count the same axis).
  const perAxis = new Map<SignalAxis, number>();
  for (const s of signals) perAxis.set(s.axis, Math.max(perAxis.get(s.axis) ?? 0, s.weight));
  const axes = [...perAxis.keys()];
  const score = [...perAxis.values()].reduce((a, b) => a + b, 0);
  const topWeight = signals[0]!.weight;

  const overwhelming = topWeight >= OVERWHELMING_WEIGHT;
  const corroborated = axes.length >= 2 && score >= ALERT_SCORE;

  let level: CaseLevel;
  let severity: AnomalySeverity;
  if (overwhelming || corroborated) {
    level = "alert";
    severity = overwhelming && corroborated ? "critical" : "high";
  } else if (topWeight >= REVIEW_WEIGHT) {
    level = "review";
    severity = "medium";
  } else {
    return { level: "clear", severity: null, score, axes, signals, summary: "" };
  }

  const lead = signals[0]!;
  const others = signals.length - 1;
  const summary =
    level === "alert"
      ? `Possible theft: ${axes.length} independent signal${axes.length > 1 ? "s" : ""} agree — ${lead.message}`
      : `Review: ${lead.message}${others > 0 ? ` (+${others} more)` : ""}`;

  return { level, severity, score, axes, signals, summary };
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
