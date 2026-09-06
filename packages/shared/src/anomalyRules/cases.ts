/** Severity ranking, multi-signal theft correlation, and anomaly reconciliation. */
import type { AnomalySeverity } from "../constants.js";
import type { RuleResult } from "./types.js";
import type { RuleId } from "./ids.js";
import { SIGNAL_META } from "./catalog.generated.js";
import type { SignalAxis } from "./catalog.generated.js";

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

// SignalAxis and SIGNAL_META (the axis + directness-of-theft weight per rule) are GENERATED from
// catalog.yaml — see catalog.generated.ts. To change a weight or add a rule, edit catalog.yaml and run
// `pnpm gen:rules`; never hand-edit the values here. Re-exported so the public barrel is unchanged.
export { SIGNAL_META };
export type { SignalAxis };

/** The single synthetic anomaly id used for a correlated per-transaction case. */
export const CASE_RULE_ID = "theft_case";

/**
 * Correlation thresholds — EXPORTED (WP2) so the UI can EXPLAIN every outcome ("score 95 < 110 →
 * review, not alert") instead of leaving them invisible. Deliberately NOT org-tunable: letting an org
 * detune the theft model silently degrades detection, and per-rule sensitivity already has a proper
 * home (thresholds table / disabledRules). Changing these is a reviewed code change, in ONE place.
 */
export const CORRELATION_THRESHOLDS = {
  /** A signal ≥ this weight is "overwhelming" and raises an alert on its own (e.g. more fuel than fits). */
  overwhelming: 85,
  /** A single signal ≥ this weight is worth a review on its own. */
  review: 60,
  /** Correlated alert: ≥2 independent axes and combined score ≥ this. */
  alertScore: 110,
} as const;
const OVERWHELMING_WEIGHT = CORRELATION_THRESHOLDS.overwhelming;
const REVIEW_WEIGHT = CORRELATION_THRESHOLDS.review;
const ALERT_SCORE = CORRELATION_THRESHOLDS.alertScore;

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
  /**
   * Rules that FIRED and score zero (Q-FUI17). Evidence, never accusation.
   *
   * They are kept OUT of `signals` rather than filtered by every consumer, because `signals` is what
   * `level`, `score` and `severity` are computed from and what `entityRisk` counts to rank a truck —
   * folding a weightless rule in there would raise a truck up a risk list on a signal the product has
   * decided carries nothing. They are kept out of NOTHING ELSE: before this field existed a weight-0
   * rule vanished at the moment it fired, which made `odometer_entry_suspect` silent for its whole
   * life and, on 2026-09-06, silently stopped `cumulative_overfuel` contaminating the MPG baseline it
   * had always been excluded from.
   */
  unscoredSignals: CaseSignal[];
  summary: string;
}

/**
 * Correlate the fired signals into ONE per-transaction case. Weak lone signals → clear (no anomaly);
 * a single strong signal → review; independent corroborating signals (or one overwhelming one) → alert.
 */
export function correlateSignals(fired: RuleResult[]): CaseAssessment {
  const all: CaseSignal[] = fired
    .map((f) => ({ ruleId: f.ruleId, ...SIGNAL_META[f.ruleId], severity: f.severity, message: f.message }))
    .sort((a, b) => b.weight - a.weight);
  // The SAME partition, done once, so the two lists cannot drift and nothing that fired is discarded.
  // Every line below this reads `signals` exactly as it did before the split (Q-FUI17).
  const signals = all.filter((s) => s.weight > 0);
  const unscoredSignals = all.filter((s) => s.weight <= 0);

  if (signals.length === 0) {
    return { level: "clear", severity: null, score: 0, axes: [], signals: [], unscoredSignals, summary: "" };
  }

  // Score = sum of the STRONGEST signal per axis (don't double-count the same axis).
  const perAxis = new Map<SignalAxis, number>();
  for (const s of signals) perAxis.set(s.axis, Math.max(perAxis.get(s.axis) ?? 0, s.weight));
  const axes = [...perAxis.keys()];
  const score = [...perAxis.values()].reduce((a, b) => a + b, 0);
  const topWeight = signals[0]!.weight;

  const overwhelming = topWeight >= OVERWHELMING_WEIGHT;
  const corroborated = axes.length >= 2 && score >= ALERT_SCORE;
  const hasCriticalSignal = signals.some((s) => s.severity === "critical");

  let level: CaseLevel;
  let severity: AnomalySeverity;
  if (overwhelming || corroborated) {
    level = "alert";
    // A contributing critical physical signal remains critical even when it is the sole overwhelming axis.
    severity = hasCriticalSignal ? "critical" : "high";
  } else if (topWeight >= REVIEW_WEIGHT) {
    level = "review";
    severity = "medium";
  } else {
    return { level: "clear", severity: null, score, axes, signals, unscoredSignals, summary: "" };
  }

  const lead = signals[0]!;
  const others = signals.length - 1;
  const summary =
    level === "alert"
      ? `Possible theft: ${axes.length} independent signal${axes.length > 1 ? "s" : ""} agree — ${lead.message}`
      : `Review: ${lead.message}${others > 0 ? ` (+${others} more)` : ""}`;

  return { level, severity, score, axes, signals, unscoredSignals, summary };
}

/**
 * WP2 "why" surface — one human sentence explaining WHY a transaction landed at its case level,
 * including the threshold math for CLEAR outcomes (previously invisible: a fired-but-sub-threshold
 * signal produced no trace anywhere). Pure; used by the fuel-log chip and anywhere else the outcome
 * needs explaining. Works from the persisted (level, score, signals) triple.
 */
export function explainCaseOutcome(level: CaseLevel, score: number, signals: Pick<CaseSignal, "ruleId" | "weight" | "axis">[]): string {
  const T = CORRELATION_THRESHOLDS;
  if (signals.length === 0) return "No detection signals fired on this fill.";
  const axes = new Set(signals.map((s) => s.axis));
  const top = signals.reduce((a, s) => Math.max(a, s.weight), 0);
  const list = signals
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((s) => `${s.ruleId} (${s.weight})`)
    .join(", ");
  if (level === "clear") {
    return (
      `${signals.length} signal${signals.length > 1 ? "s" : ""} fired but stayed below the case thresholds: ${list}. ` +
      `Strongest weight ${top} < ${T.review} (lone-review threshold) and combined score ${score} across ` +
      `${axes.size} ax${axes.size === 1 ? "is" : "es"} < ${T.alertScore} (multi-signal alert threshold).`
    );
  }
  if (level === "review") {
    return (
      `One strong signal (${list.split(",")[0]}) ≥ ${T.review} raised a review, but independent corroboration ` +
      `was insufficient for an alert (score ${score} < ${T.alertScore}, and no signal ≥ ${T.overwhelming}).`
    );
  }
  return top >= T.overwhelming
    ? `An overwhelming signal (weight ${top} ≥ ${T.overwhelming}) raised an alert on its own: ${list}.`
    : `${axes.size} independent signal axes corroborate (score ${score} ≥ ${T.alertScore}): ${list}.`;
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
  // Closed cases are historical outcomes, not active blockers. A later detection must create a new case
  // so a previously dismissed/resolved event cannot hide a new recurrence.
  const active = existing.filter((a) => a.status === "open" || a.status === "investigating");
  const activeRuleIds = new Set<string>(active.map((a) => a.rule_id));
  const firedRuleIds = new Set<string>(fired.map((f) => f.ruleId));

  const toInsert = fired.filter((f) => !activeRuleIds.has(f.ruleId));
  const toSupersedeIds = existing
    .filter((a) => a.source === "rules" && a.status === "open" && !firedRuleIds.has(a.rule_id))
    .map((a) => a.id);

  return { toInsert, toSupersedeIds };
}
