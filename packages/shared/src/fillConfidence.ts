import type { RuleContext, RuleId } from "./anomalyRules/index.js";

/**
 * FILL CONFIDENCE — one explicit, auditable description of how much we can trust a fill's telematics inputs,
 * and a single table that decides which anomaly rules are ELIGIBLE to fire for that confidence.
 *
 * Why this exists: the per-fill suppression guards (does the tank sensor reflect the whole fill? is the
 * cross-source odometer an OBD reading?) used to live scattered inside individual rule bodies as
 * `if (… !== …) return none()`. That is easy to regress and impossible to show in the UI. This module names
 * those signals in one place and centralizes the eligibility decision, so suppression is auditable and
 * testable. Phase 1 is a behaviour-preserving refactor: `ruleEligible` reproduces the previous inline guards
 * EXACTLY (locked by the existing rule golden tests). No new suppression is introduced here.
 *
 * Design posture (docs/12): precision-first. When an input is not trustworthy, the dependent rule is
 * ineligible (stays silent) rather than firing on data we can't stand behind.
 */

/** Smallest fill (gallons) that moves a coarse tank sensor measurably — Geotab notes small/partial fills are
 *  "not noticeable"; standard J1939 fuel level (SPN 96) is ~0.4%/bit. GATING (audit A2.4): a fill below this
 *  floor is `too_small`, and the per-fill sensor-measurement rules are ineligible for it (sensor noise, not
 *  signal). */
export const MIN_MEASURABLE_FILL_GAL = 15;
/** …or this fraction of tank capacity, whichever is larger. */
export const MIN_MEASURABLE_FILL_PCT = 0.08;

export interface FillConfidence {
  /** Learned per-truck: does the fuel-level sensor's rise reflect the WHOLE billed fill? Gates the per-fill
   *  volume/consumption/tank rules. "reliable" only when `vehicle.tankSensorReliable === true`. */
  tankSensor: "reliable" | "unreliable";
  /** Provenance of the cross-source (Samsara) odometer used for the absolute mismatch check. "obd" matches the
   *  dash/EFS; "other" = a GPS-derived/reconstructed reading carrying a bias a single offset can't absorb;
   *  null = no source recorded (treated as OBD for back-compat). */
  odoSource: "obd" | "other" | null;
  /** Is the fill large enough to measure against a coarse sensor? GATES the per-fill sensor-measurement rules
   *  (audit A2.4): "too_small" makes them ineligible. "unknown" (capacity/gallons missing) does NOT gate — we
   *  only suppress the specific bad case of a fill demonstrably too small to read, never on a data gap. */
  fillSize: "measurable" | "too_small" | "unknown";
}

/** Derive the confidence object from a rule context. Pure; reads only existing context/vehicle fields. */
export function computeFillConfidence(ctx: RuleContext): FillConfidence {
  const src = ctx.crossSourceOdometerSource ?? null;
  const odoSource: FillConfidence["odoSource"] = src == null ? null : src === "obd" ? "obd" : "other";

  const cap = ctx.vehicle.tankCapacityGal;
  const gal = ctx.txn.gallons;
  let fillSize: FillConfidence["fillSize"] = "unknown";
  if (cap > 0 && gal != null && gal > 0) {
    const floor = Math.max(MIN_MEASURABLE_FILL_GAL, cap * MIN_MEASURABLE_FILL_PCT);
    fillSize = gal >= floor ? "measurable" : "too_small";
  }

  return {
    tankSensor: ctx.vehicle.tankSensorReliable === true ? "reliable" : "unreliable",
    odoSource,
    fillSize,
  };
}

/**
 * Is `id` allowed to fire for this confidence? Returns true for rules with no confidence dependency.
 *
 *   - tank_space_exceeded / tank_fill_short / mpg_deviation — the per-fill SENSOR-MEASUREMENT rules: need a
 *       reliable sensor AND a fill big enough to read against a coarse J1939 level sensor. A too-small fill is
 *       sensor noise, not signal, so gating on `fillSize !== "too_small"` removes those false positives
 *       (audit A2.4). "unknown" fill-size does NOT gate — we only suppress a demonstrably-too-small fill, not a
 *       data gap, so no existing detection is newly lost.
 *   - implausible_topoff / mpg_sustained_decline — consumption/trend rules, gated on the reliable sensor only
 *       (a small single fill can't create an over-topoff, and the decline rule spans multiple fills).
 *   - odometer_mismatch / odometer_entry_suspect — eligible when the cross-source odometer is OBD or absent;
 *       ineligible only for a GPS/reconstructed reading whose bias a single offset can't absorb.
 */
export function ruleEligible(id: RuleId, c: FillConfidence): boolean {
  switch (id) {
    case "tank_space_exceeded":
    case "tank_fill_short":
    case "mpg_deviation":
      return c.tankSensor === "reliable" && c.fillSize !== "too_small";
    case "implausible_topoff":
    case "mpg_sustained_decline":
      return c.tankSensor === "reliable";
    case "odometer_mismatch":
    case "odometer_entry_suspect":
      return c.odoSource !== "other";
    default:
      return true;
  }
}
