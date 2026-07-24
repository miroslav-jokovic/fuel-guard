/** Anomaly engine core types + tank-capacity helpers. */
import type { RuleId } from "./ids.js";
import type { AnomalySeverity, FuelType } from "../constants.js";

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
  /** EFS Driver Control ID — reliable per-driver identity used to key the card-on-multiple-trucks rule
   *  when the card itself is masked to the last 4. */
  controlId?: string | null;
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
 *  1. CORROBORATION — we take the `minCorroboration`-th largest fill (default the 3rd-largest, WP5 — was
 *     2nd), not the max. The k-th largest is, by definition, a volume that ≥ k fills reached, so it now
 *     takes THREE matching over-fills inside one 30-fill window to move the capacity: a lone pump error /
 *     theft / typo can't, and even a REPEATED same-size theft has to recur three times before it could
 *     start masking itself — by which point the first two fired the capacity rules.
 *  2. PHYSICAL CEILING — when the entered nameplate is known, fills above `maxMultipleOfNameplate` × nameplate
 *     (default 2.1×, WP5 — a dual saddle-tank tractor's combined capacity + ~5% meter margin; was 2.2×)
 *     are discarded as bad data before learning, so matching outliers can't inflate the ceiling.
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
  const minCorroboration = opts.minCorroboration ?? 3;
  const maxMult = opts.maxMultipleOfNameplate ?? 2.1;

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
  /** Reefer-diversion lookback window (days) for the reefer-vs-tractor fuel comparison. Default 30. */
  reeferDiversionWindowDays?: number;
  /** Min tractor (ULSD) gallons a reefer-hauling truck must buy in the window to be "active" (else a parked
   *  reefer legitimately needs no fuel). Default 150. */
  reeferDiversionMinTractorGal?: number;
  /** Reefer (ULSR) gallons at/below which the reefer is "under-fueled" in the window. Default 0 (bought none). */
  reeferDiversionMaxReeferGal?: number;
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
  /** Ambient temperature (°F) at the fill, when backfilled (Open-Meteo / weather_cache). Drives the
   *  cold-weather MPG derate; null/undefined falls back to the calendar-month allowance (WP6). */
  ambientTempF?: number | null;
  /** Gallons from fills BETWEEN previousTxn and txn (exclusive) that were skipped when picking
   *  previousTxn (blank odometer / flagged entry). Their fuel was burned inside the span, so the
   *  per-fill MPG / top-off / band math must include it (WP4) or MPG reads inflated. Default 0. */
  intermediateGallons?: number;
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
  /** Distinct vehicles seen on this txn's CARD (true card identity — full/masked-tolerant refs with
   *  non-contradicting control ids, see sameCardFill) within the window, incl. this one. WP3: this is
   *  a CARD count, never a driver count — a driver moving trucks with different cards doesn't inflate it. */
  cardVehicleCountInWindow?: number;
  /** AS-OF-FILL-TIME learned assignment (dominant vehicle over the 60 days BEFORE this fill — WP3b).
   *  Statistical inference: enriches evidence/messages and corroborates, but NEVER fires an alarm alone
   *  (169-false-alarm lesson: a card era-change or slip-seat secondary truck is not misuse). */
  cardAssignedVehicleId?: string | null;
  /** MANUAL assignment from fuel_cards (assignment_source='manual') — a human declared this card belongs
   *  to that truck. Ground truth: a mismatch fires review-grade even as a single event. Only set for
   *  fills recent enough for the manual record to plausibly apply (WP3b). */
  cardManualAssignedVehicleId?: string | null;
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
  /** This truck currently hauls a reefer (an is_reefer trailer is paired to it). Gates reefer_fuel_diversion. */
  reeferPaired?: boolean;
  /** The ORG bought SOME reefer (ULSR) fuel in the window — proves ULSR is a tracked product for this fleet, so
   *  "this truck bought none" is meaningful rather than "this fleet doesn't code reefer fuel separately". */
  orgUsesReeferFuel?: boolean;
  /** This truck's reefer (ULSR) gallons over the reefer-diversion window (ending at this fill). */
  reeferDiversionReeferGal?: number;
  /** This truck's tractor (ULSD) gallons over the reefer-diversion window (activity signal). */
  reeferDiversionTractorGal?: number;
  /**
   * McLeod/TMS gate — did this truck pull a temperature-controlled (reefer) load in the diversion window?
   *   undefined = no TMS feed → fall back to the fuel-only heuristic (unchanged for non-TMS orgs);
   *   false     = TMS connected but NO reefer load ran → buying no reefer fuel is expected → SUPPRESS;
   *   true      = it hauled cold freight → the signal stands.
   * Only ever SUPPRESSES the alert; it never raises a new one.
   */
  reeferLoadInWindow?: boolean;
  /**
   * McLeod/TMS driver-availability gate (opt-in). Was the fill made while the ASSIGNED driver was on
   * home time / time off (fill date inside a driver_time_off window, ±1-day buffer)?
   *   undefined = no TMS feed / no driver on the fill → not evaluated (unchanged for non-TMS orgs);
   *   false     = driver was on duty → nothing to corroborate;
   *   true      = a fuel card fired while its driver was home → corroborating signal (never fires alone).
   */
  driverHomeAtFill?: boolean;
}

export interface RuleResult {
  ruleId: RuleId;
  fired: boolean;
  severity: AnomalySeverity;
  message: string;
  evidence: Record<string, unknown>;
}

export type Rule = (ctx: RuleContext) => RuleResult;

