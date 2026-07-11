/**
 * FuelGuard anomaly engine — deterministic, explainable rules (docs/02-DATA-MODEL.md §7 + §10.7–8,
 * hardened per docs/09-DETECTION-REVIEW.md). Pure functions only: the API assembles the context,
 * runs `runAllRules`, and persists the results. All quantitative math happens here (not in the AI).
 */
import { MPG_FUEL_TYPES, type AnomalySeverity, type FuelType } from "./constants.js";
import { computeFillConfidence, ruleEligible } from "./fillConfidence.js";

export const RULE_IDS = [
  // Tier 1 — odometer integrity
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump", // instant-precision only (uses elapsed hours)
  "odometer_daily_cap", // date-precision (EFS) fallback (miles/day cap)
  "odometer_mismatch", // cross-source ±tolerance reconciliation (the driver-accuracy check)
  "odometer_entry_suspect", // cross-source diff so large it's a data-entry typo / OBD glitch, not theft
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
  odometer_entry_suspect:     "Odometer Entry Needs Review",
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
  /** OBD/ECU odometer at the fueling instant (reconstructed via recon), when available. ~99.9% precise vs the
   *  ~80%-within-2mi driver-entered value, so it's the preferred basis for miles-driven (see milesSinceLast). */
  samsaraOdometer?: number | null;
  /** Provenance of samsaraOdometer: 'obd' (ECU — trustworthy), 'gps'/'reconstructed' (biased — not used for
   *  miles). Only 'obd' is used as the miles source. */
  samsaraOdometerSource?: string | null;
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
  /** LEARNED per-truck: does the Samsara fuel-level sensor's rise reflect the WHOLE billed fill? True only
   *  when the observed-rise ÷ billed ratio is consistently ≈1 (single tank, or crossover-equalized). False
   *  for dual independent tanks (ratio ≈0.5 / erratic) or until enough history clusters → tank-fill-short is
   *  suppressed, so a single sensor on a two-tank truck never produces a false short. */
  tankSensorReliable?: boolean;
  /** LEARNED robust high-percentile of observed single-fill gallons ≈ the truck's true capacity — the COMBINED
   *  capacity for a dual/saddle-tank tractor that regularly fills both tanks. Used ONLY to RAISE the effective
   *  capacity above an under-entered nameplate (never to lower it), so legitimate both-tank fills stop
   *  false-firing the capacity / over-fuel checks. See effectiveCapacityGal + learnObservedMaxFill (docs/12 §B). */
  observedMaxFillGal?: number;
}

/**
 * The capacity the volume/over-fuel checks should reconcile against. Real fleet systems (Motive, Samsara)
 * LEARN tank size from refuel history rather than trusting a nameplate, because a dual/saddle-tank tractor
 * has one sensor and an easily-mis-entered capacity. We take the larger of the entered capacity and the
 * learned observed-fill capacity, so a truck that demonstrably takes ~200 gal across two tanks is judged
 * against ~200 gal — never below what it has actually taken in one fill. Falls back to the entered value
 * when nothing is learned yet (behaviour-preserving).
 */
export function effectiveCapacityGal(v: VehicleView): number {
  return v.observedMaxFillGal != null && v.observedMaxFillGal > v.tankCapacityGal ? v.observedMaxFillGal : v.tankCapacityGal;
}

export interface ObservedCapacityResult {
  /** Corroborated high single-fill gallons ≈ the truck's true (possibly dual-tank combined) capacity. */
  gallons: number;
  /** How many fills backed the estimate (after discarding non-physical outliers). */
  samples: number;
  /** How many fills had to reach the learned volume for it to be trusted (the corroboration floor). */
  corroboration: number;
}

/**
 * Learn a truck's true fill capacity from its own billed-gallon history, used ONLY to RAISE an under-entered
 * nameplate (see effectiveCapacityGal). Because this value SUPPRESSES the over-capacity / over-fuel rules, a
 * single bad fill must never be able to train it upward and mask fraud. Two independent safeguards:
 *
 *  1. CORROBORATION — we take the `minCorroboration`-th largest fill (default the 2nd-largest), not the max.
 *     The k-th largest is, by definition, a volume that ≥ k fills reached, so a lone pump-error / theft /
 *     typo (only one fill that big) can never move the capacity — the estimate needs repeated evidence.
 *  2. PHYSICAL CEILING — when the entered nameplate is known, fills above `maxMultipleOfNameplate` × nameplate
 *     (default 2.2×, i.e. a dual saddle-tank tractor's combined capacity + margin) are discarded as bad data
 *     before learning, so even a pair of matching outliers can't inflate the ceiling.
 *
 * Returns null (not enough evidence) until ≥ `minSamples` physical fills accumulate, so the caller keeps using
 * the entered capacity during cold-start (behaviour-preserving, and the SAFE direction — a lower effective
 * capacity fires the capacity rules MORE, never less).
 */
export function learnObservedMaxFill(
  gallons: number[],
  opts: { window?: number; minSamples?: number; minCorroboration?: number; nameplateGal?: number; maxMultipleOfNameplate?: number } = {},
): ObservedCapacityResult | null {
  const window = opts.window ?? 30;
  const minSamples = opts.minSamples ?? 12;
  const minCorroboration = opts.minCorroboration ?? 2;
  const maxMult = opts.maxMultipleOfNameplate ?? 2.2;

  let vals = gallons
    .filter((g) => Number.isFinite(g) && g > 0)
    .slice(-window)
    .sort((a, b) => a - b);
  if (vals.length < minSamples) return null;

  // Physical ceiling: discard impossible fills (typos / pump errors) before learning. A genuine dual-tank
  // combined capacity is at most ~2× one entered tank; anything beyond maxMult × nameplate is bad data, not a
  // bigger tank. Skipped when no nameplate is supplied (corroboration still guards the single-outlier case).
  if (opts.nameplateGal && opts.nameplateGal > 0) {
    const ceiling = opts.nameplateGal * maxMult;
    vals = vals.filter((g) => g <= ceiling);
    if (vals.length < minSamples) return null; // too little physical evidence → fall back to nameplate
  }

  // Corroborated capacity = the largest volume reached by at least `minCorroboration` fills.
  const idx = vals.length - minCorroboration;
  if (idx < 0) return null;
  return { gallons: Math.round(vals[idx]! * 10) / 10, samples: vals.length, corroboration: minCorroboration };
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

/** The OBD/ECU odometer for a fill, ONLY when it's a real ECU reading (source 'obd') — the ~99.9%-precise one.
 *  GPS/reconstructed readings carry a per-truck bias and are never used as the miles source. */
function obdOdometer(t: TxnView): number | null {
  return t.samsaraOdometerSource === "obd" && t.samsaraOdometer != null ? t.samsaraOdometer : null;
}

/**
 * Miles driven since the previous fill. PREFERS the OBD/ECU odometer SPAN when BOTH fills have one — the ECU
 * odometer is ~99.9% precise, while driver-entered readings are only ~80% within 2 mi and add noise to every
 * consumption/efficiency rule (mpg, expected-band, top-off). The dash↔ECU offset cancels in a span, and we
 * NEVER mix sources (both OBD, or both entered). Falls back to the entered span when OBD isn't available for
 * both fills, or if the OBD span is non-positive (a reconstruction gap / rollback) — the entered span then
 * governs, exactly as before.
 */
export function milesSinceLast(txn: TxnView, prev: TxnView | null): number | null {
  if (!prev) return null;
  const tObd = obdOdometer(txn);
  const pObd = obdOdometer(prev);
  if (tObd != null && pObd != null) {
    const d = tObd - pObd;
    if (d > 0) return d;
  }
  if (txn.odometer == null || prev.odometer == null) return null;
  const d = txn.odometer - prev.odometer;
  return d > 0 ? d : null;
}

export function computedMpg(txn: TxnView, prev: TxnView | null): number | null {
  const miles = milesSinceLast(txn, prev);
  if (miles == null || txn.gallons <= 0) return null;
  return r2(miles / txn.gallons);
}

/**
 * Extra percentage points of MPG drop to ALLOW for cold weather, by month, so a legitimate winter economy hit
 * doesn't false-fire mpg_deviation. Documented effect: diesel highway MPG runs ~5–10% worse in severe cold
 * (fueleconomy.gov / fleet studies). This ONLY widens the tolerance (never tightens it), so an imperfect
 * season map can never CREATE a false alarm — worst case it's slightly more lenient in winter. Northern-
 * hemisphere / US calendar (this fleet is ~99.9% US); month read in UTC. Tune per fleet if needed.
 */
export function coldWeatherDeratePct(fueledAtIso: string): number {
  const m = new Date(fueledAtIso).getUTCMonth(); // 0=Jan … 11=Dec
  if (m === 11 || m === 0 || m === 1) return 10; // Dec–Feb: deep winter
  if (m === 10 || m === 2) return 5; // Nov, Mar: shoulder
  return 0;
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

export interface TankSensorReliabilityResult {
  /** True when the sensor's observed rise reflects the whole billed fill (ratio ≈1, single/equalized tank). */
  reliable: boolean;
  /** Median observed-rise ÷ billed ratio over the sampled fills (for transparency/UI). */
  ratio: number;
  samples: number;
}

/**
 * Learn whether a truck's Samsara fuel-level sensor reflects the WHOLE billed fill. For each recent fill with
 * both an observed tank rise and billed gallons, take ratio = observedRise / billed. A single-tank (or
 * crossover-equalized) truck reconciles NEAR 1.0 on almost every fill; a dual-independent-tank truck reads
 * only one tank so the ratio runs ~0.5, or swings wildly (both-tank vs one-tank fills, non-linear sensor).
 *
 * Reliable=true ONLY when a STRONG MAJORITY of fills land within `band` of 1.0 — the PHYSICAL truth that
 * observed rise ≈ gallons bought. The band is anchored on 1.0, NOT on the median, because a spread/bimodal
 * distribution can have a median that happens to sit in-band while the individual fills swing (real case:
 * unit 706, ratios 0.66–1.21, median 1.14 — it must NOT be called reliable). Ratios materially above 1.0 are
 * physically impossible (can't rise more than you bought → overstated capacity / non-linear sensor) and fall
 * OUTSIDE the band, so they count against reliability. Returns reliable=false when the majority don't
 * reconcile, or null when there isn't enough history yet (caller leaves the per-fill tank rules suppressed).
 *
 * The evidence floor is `minSamples = 8` (audit A2.1/A2.2). At the old floor of 4, a dual-tank truck that
 * happened to log a few single-tank fills early was prematurely marked reliable, which then ENABLED the
 * weight-90 tank_space_exceeded rule and false-fired on the next both-tank fill. Requiring 8 fills both demands
 * real evidence AND widens the window enough that a genuine dual-tank truck's occasional both-tank fill lands
 * in-sample and trips the short-fill guard below → it stays unreliable. Cold-start (< 8 fills) returns null, so
 * the per-fill tank rules stay suppressed until there's enough history — the SAFE direction (fewer false alarms;
 * cumulative_overfuel + exceeds_tank_capacity still catch gross fraud regardless of this flag).
 */
export function learnTankSensorReliability(
  pairs: { observedRiseGal: number; billedGallons: number }[],
  opts: { window?: number; minSamples?: number; band?: number; minFraction?: number; shortRatio?: number; maxShortFraction?: number } = {},
): TankSensorReliabilityResult | null {
  const window = opts.window ?? 12;
  const minSamples = opts.minSamples ?? 8;
  const band = opts.band ?? 0.15; // ±15% around 1.0 absorbs sensor coarseness
  const minFraction = opts.minFraction ?? 0.7; // ≥70% of fills must reconcile near 1.0
  const shortRatio = opts.shortRatio ?? 0.8; // observed rise below this share of billed = a "short" fill
  const maxShortFraction = opts.maxShortFraction ?? 0.12; // too many short fills ⇒ dual-tank both-fills
  const ratios = pairs
    .filter((p) => Number.isFinite(p.observedRiseGal) && Number.isFinite(p.billedGallons) && p.billedGallons > 0)
    .slice(-window)
    .map((p) => p.observedRiseGal / p.billedGallons);
  if (ratios.length < minSamples) return null;
  const near1 = ratios.filter((r) => Math.abs(r - 1) <= band).length;
  // A DUAL-tank truck whose driver USUALLY fills one tank (ratio ~1) but sometimes fills BOTH (the sensor sees
  // only one tank → observed rise ≪ billed) has a near-1 MEDIAN yet a tail of "short" fills. Those both-tank
  // fills false-fire tank_space_exceeded, so a truck with more than a small fraction of short fills is NOT
  // reliable for the per-fill space/volume checks (cumulative_overfuel + exceeds_tank_capacity still apply).
  const short = ratios.filter((r) => r < shortRatio).length;
  const reliable = near1 / ratios.length >= minFraction && short / ratios.length <= maxShortFraction;
  return { reliable, ratio: Math.round(median(ratios) * 1000) / 1000, samples: ratios.length };
}

export interface WindowOdoRow {
  /** Driver-entered odometer on the fill (noisy — typos, missed/duplicate entries). */
  enteredOdometer: number | null;
  /** Samsara fueling-time odometer (single-source + despiked upstream). */
  samsaraOdometer: number | null;
  /** Provenance of samsaraOdometer: 'obd' is a single consistent baseline; 'gps'/'reconstructed' are not. */
  samsaraSource: string | null;
}

export interface WindowMilesResult {
  /** Miles driven across the window, or null when no source is trustworthy (→ cumulative_overfuel suppressed). */
  miles: number | null;
  basis: "samsara_obd" | "entered" | "none";
}

/**
 * Robust miles-driven over the cumulative window. The over-fuel ceiling is only as trustworthy as this number,
 * and computing it from the DRIVER-ENTERED odometer span lets one typo / missed / duplicate entry collapse the
 * miles and false-fire cumulative_overfuel. So: prefer the clean OBD Samsara odometer span (single, despiked
 * baseline); fall back to the entered span ONLY when it doesn't regress (a later reading below an earlier one
 * signals a bad entry); otherwise return null so the rule stays silent (data-quality, not fraud). Rows must be
 * ordered OLDEST→NEWEST.
 */
export function robustWindowMiles(rowsOldestFirst: WindowOdoRow[]): WindowMilesResult {
  const obd = rowsOldestFirst
    .filter((r) => r.samsaraSource === "obd" && r.samsaraOdometer != null && Number.isFinite(r.samsaraOdometer))
    .map((r) => r.samsaraOdometer as number);
  if (obd.length >= 2) return { miles: Math.max(...obd) - Math.min(...obd), basis: "samsara_obd" };

  const entered = rowsOldestFirst.map((r) => r.enteredOdometer).filter((x): x is number => x != null && Number.isFinite(x));
  if (entered.length >= 2) {
    const monotonic = entered.every((v, i) => i === 0 || v >= entered[i - 1]! - 1); // no backward jump (±1 float tol)
    if (monotonic) return { miles: Math.max(...entered) - Math.min(...entered), basis: "entered" };
  }
  return { miles: null, basis: "none" };
}

/**
 * Detect a WRONG STATION COORDINATE from the pattern of how close a truck came to a station across many fills.
 * WEX documents this exact pitfall: when a station's stored/geocoded coordinate is off (city-centroid, chain
 * HQ, bad pin), EVERY fill there shows the truck a CONSISTENT distance away — a data error, not theft. Genuine
 * "card used where the truck wasn't" varies trip to trip. So if the per-fill nearest-distances to a station
 * cluster tightly at a materially non-zero value across ≥ minSamples fills, treat it as a systematic offset
 * (route the mismatch to data-quality / suppress) rather than a theft signal. Pure.
 */
export function isSystematicStationOffset(
  distancesMiles: number[],
  opts: { minSamples?: number; minOffsetMiles?: number; maxRelSpread?: number; window?: number } = {},
): boolean {
  const minSamples = opts.minSamples ?? 4;
  const minOffset = opts.minOffsetMiles ?? 1;
  const maxRelSpread = opts.maxRelSpread ?? 0.25;
  const window = opts.window ?? 20;
  const vals = distancesMiles.filter((d) => Number.isFinite(d) && d >= 0).slice(-window);
  if (vals.length < minSamples) return false;
  const med = median(vals);
  if (med < minOffset) return false; // essentially at the station → no offset to explain
  // A strong majority must sit within a tight relative band of the median (tight cluster = fixed pin error).
  const within = vals.filter((d) => Math.abs(d - med) <= maxRelSpread * med).length;
  return within / vals.length >= 0.8;
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
  // Consumption — buying more than the truck could burn. implausible_topoff (dispensed > consumed since last
  // fill) and mpg_deviation are the SAME gallons-vs-miles inequality, so they share this axis and can't
  // double-count across two axes (P-3); the axis takes the max weight, not the sum.
  implausible_topoff:         { axis: "consumption", weight: 50 },
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
  // Data-quality, NOT theft: an implausibly huge cross-source diff is a typo / OBD glitch (real odometer
  // fraud is hundreds of miles, not tens of thousands). Weight 0 → never contributes to a theft case.
  odometer_entry_suspect:     { axis: "odometer", weight: 0 },
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
