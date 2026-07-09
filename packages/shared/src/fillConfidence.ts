import type { RuleContext, RuleId } from "./anomalyRules.js";

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
 *  "not noticeable"; standard J1939 fuel level (SPN 96) is ~0.4%/bit. DESCRIPTIVE in Phase 1 (not yet gating);
 *  wired into eligibility in a later phase once the fleet's real floor is confirmed. */
export const MIN_MEASURABLE_FILL_GAL = 15;
/** …or this fraction of tank capacity, whichever is larger. DESCRIPTIVE in Phase 1 (not yet gating). */
export const MIN_MEASURABLE_FILL_PCT = 0.08;

export interface FillConfidence {
  /** Learned per-truck: does the fuel-level sensor's rise reflect the WHOLE billed fill? Gates the per-fill
   *  volume/consumption/tank rules. "reliable" only when `vehicle.tankSensorReliable === true`. */
  tankSensor: "reliable" | "unreliable";
  /** Provenance of the cross-source (Samsara) odometer used for the absolute mismatch check. "obd" matches the
   *  dash/EFS; "other" = a GPS-derived/reconstructed reading carrying a bias a single offset can't absorb;
   *  null = no source recorded (treated as OBD for back-compat). */
  odoSource: "obd" | "other" | null;
  /** Is the fill large enough to measure against a coarse sensor? DESCRIPTIVE in Phase 1 — surfaced for the UI
   *  and future gating, NOT used by `ruleEligible` yet. "unknown" when capacity/gallons are missing. */
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
 * BEHAVIOUR-LOCK (Phase 1) — these reproduce the exact inline guards that previously lived in the rules:
 *   - tank_space_exceeded / implausible_topoff / tank_fill_short / mpg_deviation / mpg_sustained_decline
 *       ← `if (vehicle.tankSensorReliable !== true) return none()`
 *   - odometer_mismatch
 *       ← `if (crossSourceOdometerSource != null && crossSourceOdometerSource !== "obd") return none()`
 *         (i.e. eligible when the source is OBD or absent; ineligible only for a GPS/reconstructed reading)
 */
export function ruleEligible(id: RuleId, c: FillConfidence): boolean {
  switch (id) {
    case "tank_space_exceeded":
    case "implausible_topoff":
    case "tank_fill_short":
    case "mpg_deviation":
    case "mpg_sustained_decline":
      return c.tankSensor === "reliable";
    case "odometer_mismatch":
      return c.odoSource !== "other";
    default:
      return true;
  }
}
