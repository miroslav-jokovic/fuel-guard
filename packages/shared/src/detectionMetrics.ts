/**
 * Detection-accuracy metrics — the measured ground truth behind any precision claim. Pure + testable;
 * the API loads disposed cases (reviewer outcomes) and this turns them into precision, a confidence
 * interval, false-positive rate, and per-signal / over-time breakdowns.
 *
 * Precision here = of the cases the system RAISED and a human DECIDED, what share were a real issue.
 *   decided   = confirmed + false_positive + benign_explained   (inconclusive is excluded — no ground truth)
 *   precision = confirmed / decided
 * We report precision with a WILSON 95% score interval so a small sample is never over-read as a hard
 * number (10/10 confirmed is "70–100%", not "100%"). Recall needs sampled clears and is handled separately.
 */
import { formatRuleId } from "./anomalyRules/index.js";
import type { AnomalyDisposition } from "./constants.js";

export interface DispositionCaseInput {
  disposition: AnomalyDisposition | null; // null = still pending (raised, not yet decided)
  /** When the case was decided (ISO) — for the trend. Falls back to nothing when absent. */
  disposedAt?: string | null;
  /** The lead signal that drove the case (top-weighted rule) — for per-signal precision. */
  leadRuleId?: string | null;
}

export interface RulePrecision {
  ruleId: string;
  label: string;
  decided: number;
  confirmed: number;
  /** Decided cases on this signal that were NOT a real issue (false alarms + legitimate-explained). */
  nonIssue: number;
  precision: number | null;
}

export interface PrecisionTrendPoint {
  /** Month bucket, "YYYY-MM". */
  period: string;
  decided: number;
  confirmed: number;
  precision: number | null;
}

export interface DetectionMetrics {
  raised: number; // all cases in scope (decided + pending)
  pending: number; // raised but not yet decided
  decided: number; // confirmed + false_positive + benign_explained
  confirmed: number;
  falsePositive: number;
  benignExplained: number;
  inconclusive: number;
  /** confirmed / decided (0..1), or null when nothing decided. */
  precision: number | null;
  /** Wilson 95% score interval on precision (null when nothing decided). */
  precisionCiLow: number | null;
  precisionCiHigh: number | null;
  /** Share of decided cases that were NOT a real issue: (false_positive + benign_explained) / decided.
   *  Equals 1 − precision. Named "non-issue" not "false-positive" because a legitimate-explained case was
   *  correctly surfaced, just not wrongdoing. */
  nonIssueRate: number | null;
  perLeadRule: RulePrecision[];
  trend: PrecisionTrendPoint[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Wilson score interval for a binomial proportion — robust for small n (unlike the naive normal
 * approximation, it never returns a bound outside [0,1] and doesn't collapse to a point at 0/1 hits).
 * z = 1.959964 → 95%.
 */
export function wilsonInterval(successes: number, total: number, z = 1.959964): { low: number; high: number } | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denom;
  return { low: Math.max(0, round3(center - margin)), high: Math.min(1, round3(center + margin)) };
}

/** Is this disposition a "decided" outcome (counts toward precision)? Inconclusive/null are not. */
function isDecided(d: AnomalyDisposition | null | undefined): d is Exclude<AnomalyDisposition, "inconclusive"> {
  return d === "confirmed" || d === "false_positive" || d === "benign_explained";
}

export function computeDetectionMetrics(cases: DispositionCaseInput[]): DetectionMetrics {
  let confirmed = 0;
  let falsePositive = 0;
  let benignExplained = 0;
  let inconclusive = 0;
  let pending = 0;

  const byRule = new Map<string, { decided: number; confirmed: number; nonIssue: number }>();
  const byMonth = new Map<string, { decided: number; confirmed: number }>();

  for (const c of cases) {
    const d = c.disposition ?? null;
    if (d === "confirmed") confirmed += 1;
    else if (d === "false_positive") falsePositive += 1;
    else if (d === "benign_explained") benignExplained += 1;
    else if (d === "inconclusive") inconclusive += 1;
    else {
      pending += 1;
      continue; // pending cases don't contribute to precision or breakdowns
    }

    if (isDecided(d)) {
      const ruleId = c.leadRuleId ?? "unknown";
      const r = byRule.get(ruleId) ?? { decided: 0, confirmed: 0, nonIssue: 0 };
      r.decided += 1;
      if (d === "confirmed") r.confirmed += 1;
      else r.nonIssue += 1; // false_positive or benign_explained → not a true issue
      byRule.set(ruleId, r);

      const period = c.disposedAt ? c.disposedAt.slice(0, 7) : "unknown"; // YYYY-MM
      const m = byMonth.get(period) ?? { decided: 0, confirmed: 0 };
      m.decided += 1;
      if (d === "confirmed") m.confirmed += 1;
      byMonth.set(period, m);
    }
  }

  const decided = confirmed + falsePositive + benignExplained;
  const precision = decided > 0 ? round3(confirmed / decided) : null;
  const ci = wilsonInterval(confirmed, decided);
  const nonIssueRate = decided > 0 ? round3((falsePositive + benignExplained) / decided) : null;

  const perLeadRule: RulePrecision[] = [...byRule.entries()]
    .map(([ruleId, r]) => ({
      ruleId,
      label: ruleId === "unknown" ? "Unattributed signal" : formatRuleId(ruleId),
      decided: r.decided,
      confirmed: r.confirmed,
      nonIssue: r.nonIssue,
      precision: r.decided > 0 ? round3(r.confirmed / r.decided) : null,
    }))
    .sort((a, b) => b.decided - a.decided || (b.precision ?? 0) - (a.precision ?? 0));

  const trend: PrecisionTrendPoint[] = [...byMonth.entries()]
    .filter(([period]) => period !== "unknown")
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([period, m]) => ({
      period,
      decided: m.decided,
      confirmed: m.confirmed,
      precision: m.decided > 0 ? round3(m.confirmed / m.decided) : null,
    }));

  return {
    raised: cases.length,
    pending,
    decided,
    confirmed,
    falsePositive,
    benignExplained,
    inconclusive,
    precision,
    precisionCiLow: ci?.low ?? null,
    precisionCiHigh: ci?.high ?? null,
    nonIssueRate,
    perLeadRule,
    trend,
  };
}
