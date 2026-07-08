/**
 * Recall estimation from a SAMPLED AUDIT of cleared transactions. Precision measures "of what we flagged,
 * how much was real"; recall measures "of the real theft, how much did we catch". You can't see misses
 * directly, so you sample the cleared (and telematics-COVERED — a miss there is a real miss, not a blind
 * spot) population, review each, and count false negatives. From that sample we extrapolate:
 *
 *   missRate   = missed / audited                         (Wilson 95% CI for small-sample honesty)
 *   estMisses  = missRate × coveredClears                 (extrapolate to the whole covered-clear pool)
 *   estRecall  = confirmed / (confirmed + estMisses)      (of all true theft, the share we caught)
 *
 * The recall RANGE is derived by pushing the miss-rate CI through the same formula (more misses → lower
 * recall). Everything is an ESTIMATE and labelled as such — it is only as good as the sample size.
 */
import { wilsonInterval } from "./detectionMetrics.js";

export interface RecallInput {
  /** Cleared, covered transactions a reviewer has audited. */
  audited: number;
  /** Of those, how many were false negatives (should have been flagged). */
  missed: number;
  /** Confirmed true-positive cases (from dispositions) — the theft we DID catch. */
  confirmed: number;
  /** Total covered-clear population to extrapolate the miss rate over. */
  coveredClears: number;
}

export interface RecallMetrics {
  audited: number;
  missed: number;
  confirmed: number;
  coveredClears: number;
  /** missed / audited (0..1), or null when nothing audited. */
  missRate: number | null;
  missRateCiLow: number | null;
  missRateCiHigh: number | null;
  /** missRate × coveredClears (point estimate), or null. */
  estimatedMisses: number | null;
  /** confirmed / (confirmed + estimatedMisses), or null when it can't be estimated. */
  estimatedRecall: number | null;
  /** Recall at the pessimistic / optimistic ends of the miss-rate CI. */
  recallLow: number | null;
  recallHigh: number | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** confirmed / (confirmed + misses); null when there's no basis (no confirmed AND no misses). */
function recallFrom(confirmed: number, misses: number): number | null {
  const denom = confirmed + misses;
  if (denom <= 0) return null;
  return round3(confirmed / denom);
}

export function computeRecallMetrics(input: RecallInput): RecallMetrics {
  const { audited, missed, confirmed, coveredClears } = input;

  if (audited <= 0) {
    return {
      audited, missed, confirmed, coveredClears,
      missRate: null, missRateCiLow: null, missRateCiHigh: null,
      estimatedMisses: null, estimatedRecall: null, recallLow: null, recallHigh: null,
    };
  }

  const missRate = round3(missed / audited);
  const ci = wilsonInterval(missed, audited);
  const estimatedMisses = Math.round(missRate * coveredClears);

  // Point estimate uses the sampled miss rate; the range uses the CI (higher miss rate → lower recall).
  const estimatedRecall = recallFrom(confirmed, estimatedMisses);
  const recallLow = ci ? recallFrom(confirmed, ci.high * coveredClears) : null; // most misses → lowest recall
  const recallHigh = ci ? recallFrom(confirmed, ci.low * coveredClears) : null; // fewest misses → highest recall

  return {
    audited, missed, confirmed, coveredClears,
    missRate,
    missRateCiLow: ci?.low ?? null,
    missRateCiHigh: ci?.high ?? null,
    estimatedMisses,
    estimatedRecall,
    recallLow,
    recallHigh,
  };
}
