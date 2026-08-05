/**
 * CAPACITY RESOLVER (WP-CAP) — measured tank capacity with confidence, replacing "trust whatever was
 * entered" as the basis for every capacity-based rule (exceeds_tank_capacity, tank_space_exceeded,
 * cumulative_overfuel).
 *
 * Why: the old effective capacity was max(entered nameplate, learned billed-gallons percentile). Both
 * sources are weak — the nameplate is a human-typed field (the #1 root cause of false capacity
 * criticals), and the billed-gallons learner polices the very numbers it learns from (repeated
 * same-size theft can train itself invisible; an OVER-entered nameplate silently kills detection and
 * nothing can ever correct it downward).
 *
 * The fix is physics: every reconciled fill with raw Samsara fuel-level percentages gives
 *   implied capacity = billed gallons ÷ (level-rise fraction)
 * A truck that takes 120 gal and rises 60 points has a ~200-gal tank — no human entry needed. The
 * robust median over recent corroborated fills measures the TRUE combined capacity (including dual
 * saddle tanks), converges in ~5 fills, and — unlike the billed-gallons learner — can correct an
 * over-entered capacity DOWNWARD, because stolen gallons produce no rise and therefore push the
 * implied capacity UP (implausible), never down. It cannot be trained by billing alone.
 *
 * resolveCapacity() reconciles the three sources into one capacity + confidence tier:
 *   high    — sensor-measured and entered agree (≤ CAPACITY_DIVERGENCE_PCT apart)
 *   medium  — sensor-measured only, or sensor contradicts entered (physics wins; divergent=true is
 *             surfaced as a DATA-QUALITY task on the Coverage page — never as silent trust)
 *   low     — entered / billed-history only (no sensor verification)
 *   none    — nothing usable → capacity rules stay off (capacityHealth flags the gap)
 *
 * capacityAlertTolerancePct() maps confidence → the overage a fill must clear before the weight-85
 * exceeds_tank_capacity alert fires: verified capacity keeps the tight org tolerance; an unverified
 * entered number needs a 15% overage for an alert-alone critical (the 5–15% band on unverified trucks
 * fires the review-grade exceeds_capacity_unverified instead). Pure module — no I/O.
 */
import { median } from "./helpers.js";
import type { VehicleView } from "./types.js";
import { effectiveCapacityGal } from "./types.js";

/** Entered vs sensor-measured capacity gap (relative to entered) beyond which the record is DIVERGENT:
 *  physics wins for detection, and the entered value is surfaced as a data-quality fix. */
export const CAPACITY_DIVERGENCE_PCT = 15;

/** A fill must move the (coarse, ~0.4%/bit J1939) level sensor by at least this many percentage points
 *  before its implied capacity is trusted — small rises amplify sensor noise into huge capacity error
 *  (±1% on a 10% rise = ±10% capacity; on a 30% rise = ±3%). */
export const SENSOR_CAP_MIN_RISE_PCT = 20;
/** …and bill at least this many gallons (mirrors the measurable-fill floor in fillConfidence). */
export const SENSOR_CAP_MIN_FILL_GAL = 25;
/** Physical sanity band for a class-8 tractor's implied capacity — anything outside is a data artifact
 *  (sensor glitch / product-code mixup), never a real tank. */
export const SENSOR_CAP_PHYSICAL_MIN_GAL = 40;
export const SENSOR_CAP_PHYSICAL_MAX_GAL = 500;

export interface SensorCapacityObservation {
  /** Billed gallons for the fill (tractor tank). */
  gallons: number;
  /** Raw Samsara fuel level % just before / after the fill (samsara_fuel_pct_before/_after). */
  pctBefore: number | null;
  pctAfter: number | null;
}

export interface SensorCapacityResult {
  /** Robust sensor-measured (combined-effective) capacity, gallons. */
  gallons: number;
  /** Valid observations that backed the estimate. */
  samples: number;
}

/**
 * Learn a truck's tank capacity from raw fill physics (billed ÷ level-rise). Guards, in order:
 *  1. Only fills with BOTH raw percentages, a rise ≥ SENSOR_CAP_MIN_RISE_PCT, and ≥ SENSOR_CAP_MIN_FILL_GAL
 *     billed — big, clearly-measured fills only.
 *  2. Per-fill implied capacity clamped to the physical sanity band (outliers discarded pre-median).
 *  3. ≥ `minSamples` surviving observations, AND a tight cluster: a strong majority within ±`clusterBand`
 *     of the median. A dual-INDEPENDENT-tank truck (sensor sees one tank) produces a bimodal spread
 *     (one-tank fills imply ~T, both-tank fills imply ~2T) and correctly gets NO verdict (null) — the
 *     resolver then falls back to the entered/billed-history path, same as today.
 * A theft fill (billed ≫ delivered) implies an inflated capacity that lands OUTSIDE the cluster (or the
 * sanity band) and is discarded — billing alone can never train this value. Pure.
 */
export function learnSensorCapacity(
  obs: SensorCapacityObservation[],
  opts: { window?: number; minSamples?: number; clusterBand?: number; minFraction?: number } = {},
): SensorCapacityResult | null {
  const window = opts.window ?? 30;
  const minSamples = opts.minSamples ?? 5;
  const clusterBand = opts.clusterBand ?? 0.15;
  const minFraction = opts.minFraction ?? 0.6;

  const windowObs = obs.slice(-window);
  const implied = windowObs
    .filter(
      (o) =>
        Number.isFinite(o.gallons) &&
        o.gallons >= SENSOR_CAP_MIN_FILL_GAL &&
        o.pctBefore != null &&
        o.pctAfter != null &&
        Number.isFinite(o.pctBefore) &&
        Number.isFinite(o.pctAfter) &&
        o.pctAfter - o.pctBefore >= SENSOR_CAP_MIN_RISE_PCT &&
        o.pctAfter <= 100 &&
        o.pctBefore >= 0,
    )
    .map((o) => o.gallons / ((o.pctAfter! - o.pctBefore!) / 100))
    .filter((c) => c >= SENSOR_CAP_PHYSICAL_MIN_GAL && c <= SENSOR_CAP_PHYSICAL_MAX_GAL);
  if (implied.length < minSamples) return null;

  const med = median(implied);
  const within = implied.filter((c) => Math.abs(c - med) <= clusterBand * med).length;
  if (within < minSamples || within / implied.length < minFraction) return null; // bimodal / noisy → no verdict

  // PHYSICAL SELF-CONTRADICTION guard (production finding, 2026-08): the level sensor can OVERSTATE the
  // rise — the post-fill reading is a plateau PEAK (slosh/slope spikes) and saddle-tank equalization lag
  // peaks the sensed tank before fuel settles across both — which UNDERSTATES capacity systematically
  // enough to pass the cluster check (240-gal trucks measured ~185). But a fill cannot bill more than
  // the tank holds: if ≥2 fills in the window billed MORE than the would-be capacity, the measurement
  // contradicts observed reality → no verdict (fall back to entered/billed-history, the SAFE direction).
  const contradictions = windowObs.filter((o) => Number.isFinite(o.gallons) && o.gallons > med * 1.05).length;
  if (contradictions >= 2) return null;

  return { gallons: Math.round(med * 10) / 10, samples: implied.length };
}

export type CapacityConfidence = "high" | "medium" | "low" | "none";

export interface ResolvedCapacity {
  /** The capacity every volume/over-fuel check reconciles against. 0 = unknown → those rules stay off. */
  gallons: number;
  confidence: CapacityConfidence;
  /** Which source produced `gallons` (for evidence / UI). */
  source: "sensor+entered" | "sensor" | "entered" | "observed_fills" | "none";
  /** True when entered and sensor-measured capacity disagree > CAPACITY_DIVERGENCE_PCT — detection runs
   *  on the sensor value (physics wins) and the entered record is surfaced as a data-quality fix. */
  divergent: boolean;
  enteredGal: number;
  sensorGal: number | null;
}

/**
 * Reconcile entered capacity, sensor-measured capacity, and billed-fill history into ONE capacity with
 * a confidence tier. Precedence: physics (sensor) > human entry > billed history. Agreement upgrades
 * confidence; contradiction trusts the sensor AND flags the record (divergent) instead of silently
 * alerting off a number someone mistyped.
 */
export function resolveCapacity(v: VehicleView): ResolvedCapacity {
  const entered = Number.isFinite(v.tankCapacityGal) && v.tankCapacityGal > 0 ? v.tankCapacityGal : 0;
  const sensorRaw = v.sensorCapacityGal != null && Number.isFinite(v.sensorCapacityGal) && v.sensorCapacityGal > 0 ? v.sensorCapacityGal : null;
  // FLOOR the sensor measurement at the corroborated observed-fill volume (production finding, 2026-08):
  // 3+ single fills of X gallons are a PHYSICAL lower bound on capacity — a sensor-implied value below
  // them is sender non-linearity / plateau-peak bias, never a smaller tank. Physics wins both ways.
  const observedFloor = v.observedMaxFillGal != null && Number.isFinite(v.observedMaxFillGal) && v.observedMaxFillGal > 0 ? v.observedMaxFillGal : null;
  const sensor = sensorRaw != null && observedFloor != null && observedFloor > sensorRaw ? observedFloor : sensorRaw;

  if (sensor != null) {
    if (entered > 0) {
      const divergent = Math.abs(sensor - entered) / entered > CAPACITY_DIVERGENCE_PCT / 100;
      if (!divergent) {
        // Agreement: take the larger of the two (never judge a truck below what both sources support).
        return { gallons: Math.max(sensor, entered), confidence: "high", source: "sensor+entered", divergent: false, enteredGal: entered, sensorGal: sensor };
      }
      // Contradiction: the tank itself measured differently from what was typed. Physics wins — this is
      // the downward-correction path an over-entered nameplate previously made impossible.
      return { gallons: sensor, confidence: "medium", source: "sensor", divergent: true, enteredGal: entered, sensorGal: sensor };
    }
    // No entered capacity at all — the sensor REVIVES detection that used to be silently dead (cap 0).
    return { gallons: sensor, confidence: "medium", source: "sensor", divergent: false, enteredGal: 0, sensorGal: sensor };
  }

  // No sensor verdict → the pre-WP-CAP behavior exactly: max(entered, corroborated billed-history), at
  // LOW confidence (an unverified human entry / billed claims — the classic false-critical source).
  const legacy = effectiveCapacityGal(v);
  if (legacy > 0) {
    return {
      gallons: legacy,
      confidence: "low",
      source: legacy > entered ? "observed_fills" : "entered",
      divergent: false,
      enteredGal: entered,
      sensorGal: null,
    };
  }
  return { gallons: 0, confidence: "none", source: "none", divergent: false, enteredGal: entered, sensorGal: null };
}

/** Observations the sensor capacity must be backed by before it may REWRITE the vehicle record
 *  (stricter than the ≥5 needed to merely store/use it for detection — a record rewrite is a bigger
 *  action than a tolerance tier, so it demands more evidence). */
export const CAPACITY_AUTOFIX_MIN_SAMPLES = 8;

export interface CapacityAutoFix {
  /** The corrected tank_capacity_gal to write. */
  gallons: number;
  reason: "filled_missing" | "corrected_divergent";
}

/**
 * Should the vehicle record's entered capacity be auto-corrected to the sensor-measured value?
 * (WP-CAP part 2 — the self-healing record.) Fires only when the measurement is rock-solid:
 *   - ≥ CAPACITY_AUTOFIX_MIN_SAMPLES clustered observations back the sensor capacity, AND
 *   - the entered capacity is MISSING (0/unset — fills the blank), or contradicts the measurement
 *     beyond CAPACITY_DIVERGENCE_PCT (the same threshold that flags the record on the Coverage page).
 * Inside the divergence band nothing is touched — small disagreement is sensor coarseness, not a wrong
 * record, and the band doubles as hysteresis (a fixed record re-fixes only if the measurement later
 * drifts > threshold from it, never churning fill-to-fill). Applies to manual entries too — a human
 * value >15% off what the tank itself measures IS wrong (the prior policy decision: physics wins) —
 * with every correction stamped tank_capacity_source='auto' and audit-logged. Pure.
 */
export function decideCapacityAutoFix(v: {
  enteredGal: number | null;
  sensorGal: number | null;
  sensorSamples: number | null;
  /** Corroborated observed single-fill volume (learnObservedMaxFill) — a PHYSICAL lower bound on
   *  capacity. A downward rewrite below it is forbidden (production finding, 2026-08: plateau-peak /
   *  sender-non-linearity bias understated 240-gal tanks to ~185 and the autofix wrote it through). */
  observedMaxFillGal?: number | null;
}): CapacityAutoFix | null {
  const raw = v.sensorGal != null && Number.isFinite(v.sensorGal) && v.sensorGal > 0 ? v.sensorGal : null;
  const samples = v.sensorSamples ?? 0;
  if (raw == null || samples < CAPACITY_AUTOFIX_MIN_SAMPLES) return null;
  const floor = v.observedMaxFillGal != null && Number.isFinite(v.observedMaxFillGal) && v.observedMaxFillGal > 0 ? v.observedMaxFillGal : null;
  const sensor = floor != null && floor > raw ? floor : raw; // same floor as resolveCapacity
  const entered = v.enteredGal != null && Number.isFinite(v.enteredGal) && v.enteredGal > 0 ? v.enteredGal : 0;
  if (entered <= 0) return { gallons: sensor, reason: "filled_missing" };
  if (Math.abs(sensor - entered) / entered > CAPACITY_DIVERGENCE_PCT / 100) {
    // Extra caution on DOWNWARD rewrites: a biased-low measurement is the known failure mode, so a
    // record may only be corrected downward when the measurement is NOT contradicted by any
    // corroborated observed fill (the floor above already lifted it if it was).
    return { gallons: sensor, reason: "corrected_divergent" };
  }
  return null;
}

/**
 * Overage tolerance (pct) a fill must clear before the alert-alone exceeds_tank_capacity fires, tiered
 * by how much the capacity number can be trusted. Never BELOW the org-configured tolerance — tiers only
 * widen it when the capacity is less verified (precision-first; the unverified 5–15% band still
 * surfaces as the review-grade exceeds_capacity_unverified signal, so nothing goes silent).
 */
export function capacityAlertTolerancePct(confidence: CapacityConfidence, configuredPct: number): number {
  const base = Number.isFinite(configuredPct) && configuredPct > 0 ? configuredPct : 5;
  if (confidence === "high") return base;
  if (confidence === "medium") return Math.max(base, 10);
  return Math.max(base, 15);
}
