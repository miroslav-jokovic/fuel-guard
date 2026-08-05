/** Tier 4 (behavioral) + Tier A (reefer) rule bodies — split from rules.ts (file-size budget).
 * Same private-rule contract: each takes RuleContext, returns RuleResult; runAllRules composes them. */
import type { RuleContext, RuleResult, TxnView } from "./types.js";
import {
  hoursBetween,
  eventTime,
  timeReliable,
  isOffHours,
  none,
  r2,
  TANK_FILL_MIN_TOLERANCE_GAL,
  tankShortTolerancePct,
} from "./helpers.js";
import { stateTimeZone } from "../efsImport/dateTime.js";
import { haversineMiles } from "../ai.js";

/** Two station pins within this distance are ONE physical site (a truck stop straddling an exit). */
export const SAME_SITE_MILES = 1.0;
/** Minimum inter-fill distance before the impossible-travel check applies — below it, geocode pin noise
 *  (city-centroid pins) could fabricate an impossible speed across town. */
export const IMPOSSIBLE_TRAVEL_MIN_MILES = 60;
/** Truck-vs-station distance beyond which a location mismatch fires even INSIDE the same state
 *  (the old state-level comparison was blind to a card used 200 mi away in Texas). */
export const LOCATION_DISTANCE_MISMATCH_MILES = 25;
/** …and beyond this it is severity-high (nowhere near the station). */
export const LOCATION_DISTANCE_FAR_MILES = 100;

/** Distance between the two fills' station pins, when both are resolved. Null otherwise. */
function stationDistanceMiles(a: TxnView, b: TxnView): number | null {
  if (a.stationLat == null || a.stationLng == null || b.stationLat == null || b.stationLng == null)
    return null;
  return haversineMiles(a.stationLat, a.stationLng, b.stationLat, b.stationLng);
}

/** Same physical station? REAL DISTANCE when both fills carry a resolved pin (WP-BEH — string matching
 *  wrongly exempted two different truck stops in one city, and wrongly split one station's name
 *  variants); site name / city+state strings only as fallback. Unknown → false (never exempt on a
 *  guess — WP7). */
function sameSite(a: TxnView, b: TxnView): boolean {
  const dist = stationDistanceMiles(a, b);
  if (dist != null) return dist <= SAME_SITE_MILES;
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  if (a.locationText && b.locationText) return norm(a.locationText) === norm(b.locationText);
  if (a.city && b.city && a.state && b.state)
    return norm(a.city) === norm(b.city) && norm(a.state) === norm(b.state);
  return false;
}

/** Market cost-outlier margin: a fill priced ≥35% over the regional posted-diesel median is an outlier
 *  (station spread runs ~±10–15%; 35% is conservative — receipt inflation / collusion territory). */
export const MARKET_PRICE_OUTLIER_MULT = 1.35;

export function ruleRapidRepeatFueling(ctx: RuleContext): RuleResult {
  const { txn, previousTxn, thresholds } = ctx;
  if (!previousTxn) return none("rapid_repeat_fueling");
  // BOTH timestamps must be RELIABLE instants — a date-only noon sentinel or an uncorroborated EFS
  // posted time fabricates the interval and false-fires. (txn's own reliability is gated by runAllRules.)
  if (!timeReliable(previousTxn)) return none("rapid_repeat_fueling");
  const hours = hoursBetween(eventTime(previousTxn), eventTime(txn));
  if (hours >= thresholds.rapidRefuelHours) return none("rapid_repeat_fueling");
  // WP7 — same-STATION exemption: two swipes at one site inside the window are a split purchase (pump
  // pre-auth cap forces a second transaction) or a pull-forward top-off, not a theft interval. The
  // volume side is still fully covered by cumulative_overfuel / tank_space_exceeded. Different sites
  // minutes apart remain exactly the signal this rule exists for. Unknown location never exempts.
  if (sameSite(txn, previousTxn)) return none("rapid_repeat_fueling");
  const gallons = r2(txn.gallons + previousTxn.gallons);
  return {
    ruleId: "rapid_repeat_fueling",
    fired: true,
    severity: "high",
    message: `Another fill-up occurred ${r2(hours * 60)} minutes after the previous one at a different station (${gallons} gal combined).`,
    evidence: {
      minutesSincePrev: r2(hours * 60),
      thresholdHours: thresholds.rapidRefuelHours,
      combinedGallons: gallons,
      prevSite:
        previousTxn.locationText ??
        ([previousTxn.city, previousTxn.state].filter(Boolean).join(", ") || null),
      site: txn.locationText ?? ([txn.city, txn.state].filter(Boolean).join(", ") || null),
    },
  };
}

/**
 * WP-BEH — IMPOSSIBLE TRAVEL: two fills on the same vehicle whose station pins are far enough apart
 * that no truck could cover the distance in the elapsed time (implied speed > maxPlausibleMph). Near-
 * proof of card sharing/cloning — one of the two fills was made without the truck. Guards: both fills
 * need RELIABLE instants and resolved pins; distance must clear IMPOSSIBLE_TRAVEL_MIN_MILES (pin noise
 * can't fabricate 60 mi); gaps over 24h are ignored (stale pairs aren't a travel claim). Weight 70 —
 * review-alone, alerts with one corroborating axis.
 */
export function ruleImpossibleTravel(ctx: RuleContext): RuleResult {
  const { txn, previousTxn, thresholds } = ctx;
  if (!previousTxn || !timeReliable(previousTxn)) return none("impossible_travel");
  const dist = stationDistanceMiles(txn, previousTxn);
  if (dist == null || dist < IMPOSSIBLE_TRAVEL_MIN_MILES) return none("impossible_travel");
  const hours = hoursBetween(eventTime(previousTxn), eventTime(txn));
  if (hours <= 0 || hours > 24) return none("impossible_travel");
  const mph = dist / hours;
  if (mph <= thresholds.maxPlausibleMph) return none("impossible_travel");
  return {
    ruleId: "impossible_travel",
    fired: true,
    severity: "high",
    message: `This card fueled ${r2(dist)} mi apart within ${r2(hours * 60)} minutes (implied ${r2(mph)} mph) — one truck cannot have made both fills.`,
    evidence: {
      distanceMiles: r2(dist),
      minutesBetween: r2(hours * 60),
      impliedMph: r2(mph),
      maxPlausibleMph: thresholds.maxPlausibleMph,
      prevSite: previousTxn.locationText ?? null,
      site: txn.locationText ?? null,
    },
  };
}

export function ruleOffHoursFueling(ctx: RuleContext): RuleResult {
  const { txn, operatingHours } = ctx;
  const at = eventTime(txn); // telematics stop time when corroborated — not a possibly-wrong EFS auth time
  // WP7 — TRUCK-LOCAL evaluation: the fill's clock is judged in the STATION state's timezone (where the
  // driver physically is), not the office's. A coast-to-coast fleet's 7pm-Pacific fill is not "9pm
  // Central". Falls back to the org tz when the station state is unknown.
  const tz = stateTimeZone(txn.state) ?? operatingHours.tz;
  if (isOffHours(at, { ...operatingHours, tz })) {
    return {
      ruleId: "off_hours_fueling",
      fired: true,
      severity: "medium",
      message: `Fueled outside operating hours (${operatingHours.start}–${operatingHours.end} ${tz === operatingHours.tz ? operatingHours.tz : `${tz}, station-local`}).`,
      evidence: { fueledAt: at, window: `${operatingHours.start}-${operatingHours.end}`, tz },
    };
  }
  return none("off_hours_fueling");
}

export function ruleUnattributed(ctx: RuleContext): RuleResult {
  const { txn } = ctx;
  const missing: string[] = [];
  if (txn.vehicleId == null) missing.push("vehicle");
  if (txn.driverId == null) missing.push("driver");
  if (missing.length) {
    return {
      ruleId: "unattributed_transaction",
      fired: true,
      severity: "high",
      message: `Transaction is missing ${missing.join(" and ")} attribution.`,
      evidence: { missing },
    };
  }
  return none("unattributed_transaction");
}

export function ruleCostOutlier(ctx: RuleContext): RuleResult {
  const { txn, thresholds } = ctx;
  const { costMinPerGal: min, costMaxPerGal: max } = thresholds;
  if (txn.pricePerGal == null) return none("cost_outlier");
  // Org-configured static bounds (when set) keep firing exactly as before.
  if ((min != null && txn.pricePerGal < min) || (max != null && txn.pricePerGal > max)) {
    return {
      ruleId: "cost_outlier",
      fired: true,
      severity: "low",
      message: `Price $${txn.pricePerGal}/gal is outside the expected range.`,
      evidence: { pricePerGal: txn.pricePerGal, min, max },
    };
  }
  // WP7 — market variant: before this, cost_outlier was OFF unless an org configured static bounds
  // (defaults null). With the global posted-price layer, a fill ≥35% over the regional (state, ±3-day)
  // posted-diesel median is an outlier on real market data. Above-market only: an inflated price is the
  // theft-relevant direction (receipt inflation / collusion); cheap fuel is not misuse.
  const market = ctx.marketPricePerGal;
  if (market != null && market > 0 && txn.pricePerGal > market * MARKET_PRICE_OUTLIER_MULT) {
    return {
      ruleId: "cost_outlier",
      fired: true,
      severity: "low",
      message: `Price $${txn.pricePerGal}/gal is ${r2(((txn.pricePerGal - market) / market) * 100)}% above the regional posted-diesel median ($${r2(market)}/gal).`,
      evidence: {
        pricePerGal: txn.pricePerGal,
        marketMedianPerGal: r2(market),
        overMarketPct: r2(((txn.pricePerGal - market) / market) * 100),
        marketOutlierMult: MARKET_PRICE_OUTLIER_MULT,
      },
    };
  }
  return none("cost_outlier");
}

/**
 * Telematics shows the truck was in a DIFFERENT STATE than the EFS fuel station at the exact fueling
 * time — a high-confidence "card used where the truck isn't" signal. Set only from a precise time +
 * state comparison (docs/10 §11); an unconfirmed/uncertain location is `null` and never fires here.
 */
export function ruleLocationMismatch(ctx: RuleContext): RuleResult {
  if (ctx.samsaraLocationMatched === false) {
    return {
      ruleId: "location_mismatch",
      fired: true,
      severity: "high",
      message:
        "Telematics places the vehicle in a different state than the fuel station at the fueling time.",
      evidence: { samsaraLocationMatched: false, ...(ctx.locationEvidence ?? {}) },
    };
  }
  // WP-BEH — DISTANCE tier: the state comparison was blind to a card used 200 mi away in the SAME state.
  // With a reliable fueling instant and a truck-vs-station distance beyond the threshold, the mismatch
  // fires on miles, tiered by how far. Guards: never on a suspect station pin (the wrong-coordinate
  // pattern the systematic-offset learner flags routes to data-quality, not theft), and never without a
  // trustworthy instant (a settlement-time position comparison is meaningless).
  const dist = ctx.truckToStationMiles;
  const pinSuspect =
    (ctx.locationEvidence as { dataQuality?: string } | null | undefined)?.dataQuality ===
    "station_coordinate_suspect";
  if (
    dist != null &&
    dist > LOCATION_DISTANCE_MISMATCH_MILES &&
    !pinSuspect &&
    timeReliable(ctx.txn)
  ) {
    const far = dist > LOCATION_DISTANCE_FAR_MILES;
    return {
      ruleId: "location_mismatch",
      fired: true,
      severity: far ? "high" : "medium",
      message: `Telematics places the vehicle ~${r2(dist)} mi from the fuel station at the fueling time.`,
      evidence: {
        truckToStationMiles: r2(dist),
        thresholdMiles: LOCATION_DISTANCE_MISMATCH_MILES,
        tier: far ? "far" : "near",
        ...(ctx.locationEvidence ?? {}),
      },
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
export function ruleTankFillShort(ctx: RuleContext): RuleResult {
  // Only fire when the sensor is LEARNED to reflect the whole fill (observed/billed ≈1); two-tank / not-yet-
  // learned trucks read ~half a fill and false-flag. Reliability gate centralized in ruleEligible (docs/12).
  const short = ctx.tankFillShortGal;
  if (short == null || short <= 0) return none("tank_fill_short");
  // WP-BEH PRECISION-SCALED tolerance: sized by THIS truck's measured sensor noise (3σ of its
  // observed/billed ratio history, clamped 8–30%) instead of the blanket 30% — a clean sensor's
  // detection floor drops from ~30 gal to ~9 gal on a 100-gal bill. No learned sigma → legacy 30%.
  const tolPct = tankShortTolerancePct(ctx.vehicle.tankRatioSigma);
  const tol = Math.max(TANK_FILL_MIN_TOLERANCE_GAL, ctx.txn.gallons * tolPct);
  if (short <= tol) return none("tank_fill_short");
  const observed = ctx.tankObservedRiseGal;
  return {
    ruleId: "tank_fill_short",
    fired: true,
    severity: "low",
    message: `Telematics tank level rose ~${observed != null ? r2(observed) : "?"} gal, about ${r2(short)} gal less than the ${ctx.txn.gallons} gal billed — beyond this truck's ~${r2(tol)} gal sensor tolerance (review).`,
    evidence: {
      gallonsBilled: ctx.txn.gallons,
      observedRiseGal: observed,
      shortGal: r2(short),
      toleranceGal: r2(tol),
      tolerancePct: r2(tolPct * 100),
      sensorRatioSigma: ctx.vehicle.tankRatioSigma ?? null,
    },
  };
}

/** Chronic-short window floors: at least this many measured fills, and the summed shortfall must clear
 *  BOTH an absolute floor and a sigma-scaled share of the window's billed volume. */
export const CHRONIC_SHORT_MIN_FILLS = 6;
export const CHRONIC_SHORT_MIN_GAL = 25;
export const CHRONIC_SHORT_SIGMA_MULT = 1.5;
export const CHRONIC_SHORT_DEFAULT_SIGMA = 0.15;

/**
 * WP-BEH — CHRONIC TANK SHORTFALL: the sustained-small-skim detector the per-fill rule can't be.
 * Sensor noise is symmetric, so across N measured fills the signed residuals (billed − observed rise)
 * should hover near zero; a persistent ONE-DIRECTION shortfall — each fill individually inside the
 * per-fill tolerance — is fuel repeatedly leaving the pump without entering this tank (siphoning /
 * container fills). This closes the documented WP5 detection floor for trucks with a reliable sensor.
 * Threshold: max(absolute floor, sigma-scaled share of the window's billed gallons) so a noisy sensor
 * needs proportionally more evidence. Gated on the learned-reliable sensor (ruleEligible).
 */
export function ruleTankChronicShort(ctx: RuleContext): RuleResult {
  const w = ctx.tankResidualWindow;
  if (!w || w.fills < CHRONIC_SHORT_MIN_FILLS || w.totalBilledGal <= 0)
    return none("tank_chronic_short");
  const sigma =
    ctx.vehicle.tankRatioSigma != null && ctx.vehicle.tankRatioSigma > 0
      ? ctx.vehicle.tankRatioSigma
      : CHRONIC_SHORT_DEFAULT_SIGMA;
  const threshold = Math.max(
    CHRONIC_SHORT_MIN_GAL,
    w.totalBilledGal * CHRONIC_SHORT_SIGMA_MULT * sigma,
  );
  if (w.sumShortGal <= threshold) return none("tank_chronic_short");
  return {
    ruleId: "tank_chronic_short",
    fired: true,
    severity: "high",
    message: `Across the last ${w.fills} measured fills the tank absorbed ~${r2(w.sumShortGal)} gal less than the ${r2(w.totalBilledGal)} gal billed — a persistent one-direction shortfall beyond this truck's sensor noise (~${r2(threshold)} gal), consistent with repeated small skims.`,
    evidence: {
      windowFills: w.fills,
      sumShortGal: r2(w.sumShortGal),
      totalBilledGal: r2(w.totalBilledGal),
      thresholdGal: r2(threshold),
      sensorRatioSigma: sigma,
    },
  };
}

/**
 * WP-BEH — LINE-MATH INTEGRITY: total_cost should equal gallons × price/gal. A material mismatch is an
 * import defect or a tampered receipt — either way the row's money math can't be trusted. Data-quality
 * (weight 0, suppressed — facts stay on the transaction, never an alert): EFS line fees/rounding are
 * absorbed by the tolerance (larger of $5 or 2%).
 */
export function ruleCostLineMismatch(ctx: RuleContext): RuleResult {
  const { txn } = ctx;
  if (txn.totalCost == null || txn.pricePerGal == null || txn.gallons <= 0)
    return none("cost_line_mismatch");
  const expected = txn.gallons * txn.pricePerGal;
  const diff = Math.abs(txn.totalCost - expected);
  if (diff <= Math.max(5, expected * 0.02)) return none("cost_line_mismatch");
  return {
    ruleId: "cost_line_mismatch",
    fired: true,
    severity: "low",
    message: `Total $${r2(txn.totalCost)} differs from gallons × price ($${r2(expected)}) by $${r2(diff)} — check this line for an import defect or altered receipt.`,
    evidence: {
      totalCost: txn.totalCost,
      gallons: txn.gallons,
      pricePerGal: txn.pricePerGal,
      expectedTotal: r2(expected),
      diff: r2(diff),
    },
  };
}

/**
 * Reefer tank capacity for a fill — ONLY when actually known (a paired, reefer-marked trailer); null
 * otherwise, so the reefer rules never judge "exceeds capacity" against an ASSUMED tank size.
 */
function knownReeferTankGal(ctx: RuleContext): number | null {
  return ctx.reeferTankCapacityGal != null && ctx.reeferTankCapacityGal > 0
    ? ctx.reeferTankCapacityGal
    : null;
}

/**
 * A single reefer (ULSR) purchase exceeds the reefer tank capacity — the fuel can't fit in the reefer
 * (gun-switching / container fill). Only fires when the reefer tank size is KNOWN (paired trailer).
 */
export function ruleReeferExceedsCapacity(ctx: RuleContext): RuleResult {
  const { txn, thresholds } = ctx;
  const cap = knownReeferTankGal(ctx);
  if (cap == null) return none("reefer_exceeds_capacity"); // unknown tank → never accuse on an assumption
  const limit = cap * (1 + thresholds.capacityTolerancePct / 100);
  if (txn.gallons > limit) {
    return {
      ruleId: "reefer_exceeds_capacity",
      fired: true,
      severity: "critical",
      message: `Reefer fill of ${txn.gallons} gal exceeds the reefer tank capacity (${cap} gal) — the fuel can't fit in the reefer.`,
      evidence: {
        gallons: txn.gallons,
        reeferCapacity: cap,
        tolerancePct: thresholds.capacityTolerancePct,
      },
    };
  }
  return none("reefer_exceeds_capacity");
}

/**
 * Rolling window: reefer gallons since the last reefer fill exceed what a reefer unit could physically
 * burn (max burn rate × elapsed hours) plus one full tank. Only fires when the reefer tank size is KNOWN
 * — an assumed tank would mis-size the burnable envelope and false-flag large-reefer trucks.
 */
export function ruleReeferOverfuelRate(ctx: RuleContext): RuleResult {
  const { thresholds } = ctx;
  const cap = knownReeferTankGal(ctx);
  if (cap == null) return none("reefer_overfuel_rate");
  const gph = thresholds.maxReeferBurnGph ?? 1.5;
  const hrs = thresholds.cumulativeWindowHours ?? 48;
  const windowGal = ctx.reeferWindowGallons ?? ctx.txn.gallons;
  const maxPlausible = gph * hrs + cap; // could burn at most this in the window, plus a one-tank refill
  if (windowGal > maxPlausible) {
    return {
      ruleId: "reefer_overfuel_rate",
      fired: true,
      severity: "high",
      message: `Reefer bought ${r2(windowGal)} gal in ${hrs}h — more than a reefer could burn (${gph} gal/h ≈ ${r2(gph * hrs)} gal) plus a full ${cap}-gal tank.`,
      evidence: {
        reeferWindowGallons: r2(windowGal),
        maxBurnGph: gph,
        windowHours: hrs,
        reeferCapacity: cap,
        maxPlausibleGal: r2(maxPlausible),
      },
    };
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
export function ruleReeferFuelDiversion(ctx: RuleContext): RuleResult {
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
    evidence: {
      reeferGalInWindow: r2(winReefer),
      tractorGalInWindow: r2(winTractor),
      windowDays: days,
      minTractorGal: minTractor,
      maxReeferGal: maxReefer,
      reeferLoadInWindow: ctx.reeferLoadInWindow ?? null,
    },
  };
}

/** Card misuse (WP3, hardened in WP3b after 169 false alarms): the count is a true CARD identity count
 *  (never a driver count). FIRES only on:
 *    1. a MANUAL (human-declared) assignment mismatch — ground truth, single event is review-grade; or
 *    2. the card demonstrably fueling ≥2 trucks inside the window — the classic split-use pattern
 *       (message enriched with the as-of-fill-time learned assignment when one exists).
 *  A LEARNED assignment mismatch alone NEVER fires: as-of learning is statistical, and a card era-change
 *  or a slip-seat secondary truck is not misuse. Samsara's driver-assignment reconcile
 *  (cardMultiReconcile) still auto-clears one-driver-moved-trucks cases.
 *
 *  WP3c: hard-gated on card IDENTIFIABILITY. Since EFS stopped printing full card numbers, a bare or
 *  masked ref is shared by every card ending in those 4 digits — so a card we cannot name is a card we
 *  never accuse. */
export function ruleCardMultiVehicle(ctx: RuleContext): RuleResult {
  const count = ctx.cardVehicleCountInWindow ?? 0;
  const asOf = ctx.cardAssignedVehicleId ?? null;
  const manual = ctx.cardManualAssignedVehicleId ?? null;
  const hrs = ctx.thresholds.cumulativeWindowHours ?? 48;
  // Fail closed: undefined (a caller that never resolved card context) is treated as unidentifiable.
  // Belt-and-braces — the scorer already reports a count of 0 for an unidentifiable card.
  if (ctx.cardIdentifiable !== true) return none("card_multi_vehicle");
  if (
    ctx.txn.cardRef &&
    manual != null &&
    ctx.txn.vehicleId != null &&
    ctx.txn.vehicleId !== manual
  ) {
    return {
      ruleId: "card_multi_vehicle",
      fired: true,
      severity: "high",
      message: `This fuel card is manually assigned to a different truck than the one it fueled${count >= 2 ? ` (and fueled ${count} vehicles within ${hrs}h)` : ""}.`,
      evidence: {
        manualAssignedVehicleId: manual,
        vehicleId: ctx.txn.vehicleId,
        vehicleCount: count,
        windowHours: hrs,
      },
    };
  }
  if (ctx.txn.cardRef && count >= 2) {
    const offNote =
      asOf != null && ctx.txn.vehicleId != null && ctx.txn.vehicleId !== asOf
        ? " — including this fill on a truck other than the card's usual one"
        : "";
    return {
      ruleId: "card_multi_vehicle",
      fired: true,
      severity: "high",
      message: `This fuel card fueled ${count} different vehicles within ${hrs}h${offNote}.`,
      evidence: { vehicleCount: count, windowHours: hrs, asOfAssignedVehicleId: asOf },
    };
  }
  return none("card_multi_vehicle");
}

/** Fuel bought while the ASSIGNED driver was demonstrably NOT WORKING — corroborates misuse; below the
 *  lone-review threshold, so never fires alone. WP-BEH: two independent sources feed the same signal —
 *  the opt-in TMS home-time window (ctx.driverHomeAtFill) and the driver's own ELD logbook showing an
 *  EXTENDED off-duty/sleeper block around the fill (ctx.driverOffDutyAtFill; buffered away from duty
 *  transitions so shift-start fueling never flags). McLeod plugs in as a third source unchanged. */
export function ruleFuelWhileDriverHome(ctx: RuleContext): RuleResult {
  const tms = ctx.driverHomeAtFill === true;
  const eld = ctx.driverOffDutyAtFill === true;
  if (!tms && !eld) return none("fuel_while_driver_home");
  const source = tms && eld ? "tms+eld" : tms ? "tms" : "eld";
  const how = tms
    ? "on home time / off duty (TMS)"
    : "deep inside an extended ELD off-duty/sleeper block";
  return {
    ruleId: "fuel_while_driver_home",
    fired: true,
    severity: "medium",
    message: `Fuel was purchased while the assigned driver was ${how}.`,
    evidence: { driverHomeAtFill: tms, driverOffDutyAtFill: eld, source },
  };
}
