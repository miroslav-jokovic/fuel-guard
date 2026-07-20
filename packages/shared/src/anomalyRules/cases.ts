/** Severity ranking, multi-signal theft correlation, and anomaly reconciliation. */
import type { AnomalySeverity } from "../constants.js";
import type { RuleResult } from "./types.js";
import type { RuleId } from "./ids.js";

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
  // Behavioral: reefer-hauling truck buying no reefer fuel. Review on its own (weight ≥ REVIEW_WEIGHT); with
  // tank_fill_short (volume) on the same ULSD fill the two axes agree → alert.
  reefer_fuel_diversion:      { axis: "reefer", weight: 60 },
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
