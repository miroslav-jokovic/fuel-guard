/** Tier 3 efficiency rules. Each rule takes RuleContext and returns RuleResult. */
import type { RuleContext, RuleResult } from "./types.js";
import {
  coldWeatherDeratePct,
  computedMpg,
  effectiveBaseline,
  median,
  milesSinceLast,
  none,
  recentMpgSeries,
  r2,
} from "./helpers.js";

function ruleMpgDeviation(ctx: RuleContext): RuleResult {
  const { txn, vehicle, previousTxn, recentTxns, thresholds } = ctx;
  // Per-fill MPG = miles ÷ THIS fill's gallons. Only reliable when fills reconcile with the tank (to-full,
  // single effective tank). On an irregular / dual-tank fill the gallons are inflated vs the miles, so MPG
  // looks artificially low → false deviation. Gross overfueling is still caught by cumulative_overfuel.
  // Tank-sensor-reliability gate centralized in ruleEligible/computeFillConfidence (docs/12).
  const mpg = computedMpg(txn, previousTxn, ctx.intermediateGallons ?? 0);
  const baseline = effectiveBaseline(vehicle, recentTxns);
  if (mpg == null || baseline == null || baseline <= 0) return none("mpg_deviation");
  // Allow a wider drop in cold months (diesel legitimately loses ~5–10% MPG in severe cold) so winter fills
  // don't false-fire. Derate only widens the band; it never makes the rule fire when it otherwise wouldn't.
  const coldDerate = coldWeatherDeratePct(txn.fueledAt, ctx.ambientTempF);
  const effectiveDropPct = thresholds.mpgDropPct + coldDerate;
  const floor = baseline * (1 - effectiveDropPct / 100);
  if (mpg < floor) {
    const coldNote = coldDerate ? ` (allowing +${coldDerate}% for cold-weather economy)` : "";
    return {
      ruleId: "mpg_deviation",
      fired: true,
      severity: "high",
      message: `MPG ${mpg} is ${r2(((baseline - mpg) / baseline) * 100)}% below the baseline ${r2(baseline)}${coldNote}.`,
      evidence: {
        computedMpg: mpg,
        baselineMpg: r2(baseline),
        dropPct: thresholds.mpgDropPct,
        coldWeatherDeratePct: coldDerate,
        effectiveDropPct,
      },
    };
  }
  return none("mpg_deviation");
}

export const MPG_SUSTAINED_MIN_FILLS = 6;
export const MPG_SUSTAINED_MIN_MILES = 750;

function ruleMpgSustainedDecline(ctx: RuleContext): RuleResult {
  const { txn, recentTxns } = ctx;
  // Built from per-fill MPGs — same reliability caveat as mpg_deviation: a run of irregular / dual-tank
  // fills drags the recent median down artificially. Reliability gate centralized in ruleEligible (docs/12).
  const ordered = [...recentTxns, txn];
  const series = recentMpgSeries(ordered);
  const totalMiles = ordered.slice(1).reduce((sum, current, i) => sum + (milesSinceLast(current, ordered[i]!) ?? 0), 0);
  // Six tiny intervals can be dominated by odometer/sensor resolution noise. Require a real distance span
  // before calling a trend sustained; this is an evidence gate, not a sensitivity change.
  if (series.length < MPG_SUSTAINED_MIN_FILLS || totalMiles < MPG_SUSTAINED_MIN_MILES)
    return none("mpg_sustained_decline");
  const last3 = median(series.slice(-3));
  const prior3 = median(series.slice(-6, -3));
  // Base 10% decline threshold, widened by the cold-weather allowance (P-6b) so a legitimate fall→winter
  // economy decline doesn't false-fire. Only ever widens the band.
  const coldDerate = coldWeatherDeratePct(txn.fueledAt, ctx.ambientTempF);
  const declineFactor = 1 - (10 + coldDerate) / 100;
  if (prior3 > 0 && last3 < prior3 * declineFactor) {
    const coldNote = coldDerate ? ` (allowing +${coldDerate}% for cold-weather economy)` : "";
    return {
      ruleId: "mpg_sustained_decline",
      fired: true,
      severity: "medium",
      message: `Recent MPG (${r2(last3)}) has declined more than ${10 + coldDerate}% versus the prior period (${r2(prior3)})${coldNote}.`,
      evidence: {
        recentMedian: r2(last3),
        priorMedian: r2(prior3),
        coldWeatherDeratePct: coldDerate,
      },
    };
  }
  return none("mpg_sustained_decline");
}

export { ruleMpgDeviation, ruleMpgSustainedDecline };
