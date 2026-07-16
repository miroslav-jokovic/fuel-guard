/**
 * Price-history learning (Phase 5). When a station has no FRESH diesel price (the daily report skipped it or
 * its last quote is older than the org's freshness window), estimate one from its own recent history — falling
 * back to a brand-level median — so the planner can still consider the station instead of dropping it. Every
 * estimate is labelled with a confidence + basis so the UI can show it as "est." and the solver can prefer real
 * prices. Pure: no I/O, fully unit-tested. The caller supplies the samples (from `fuel_prices`).
 */

const HOUR = 3_600_000;

/** How far back a station's own history is trusted for an estimate (older quotes are ignored). */
export const DEFAULT_PRICE_LOOKBACK_HOURS = 21 * 24; // 21 days

export type PriceConfidence = "high" | "medium" | "low";
/** Where the price came from: a fresh tenant quote, a fresh POSTED price with the org's discount rule
 *  applied, this station's older history, a brand median, or nothing. */
export type PriceBasis = "fresh" | "posted_discount" | "station_history" | "brand" | "none";

export interface PriceSample {
  net: number | null;
  observedAtMs: number;
}

export interface PriceEstimate {
  /** Net $/gal to plan with, or null when nothing (not even a brand median) is available. */
  net: number | null;
  /** false = a fresh, real quote; true = derived from history / brand fallback. */
  estimated: boolean;
  confidence: PriceConfidence;
  basis: PriceBasis;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Median of a numeric list (null when empty). Average of the two middles for an even count. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Estimate a station's diesel price.
 *  1. A quote within `ttlHours` → use it as-is (not estimated, high confidence).
 *  2. Else the median of this station's quotes within `lookbackHours` → estimated (medium with ≥3 samples, else low).
 *  3. Else a supplied brand median → estimated, low.
 *  4. Else null (truly unknown — the solver treats it as no-price / emergency-only).
 */
export function estimateStationPrice(
  samples: PriceSample[],
  nowMs: number,
  opts: { ttlHours: number; lookbackHours?: number; brandMedian?: number | null },
): PriceEstimate {
  const lookbackHours = opts.lookbackHours ?? DEFAULT_PRICE_LOOKBACK_HOURS;
  const valid = samples.filter((s): s is { net: number; observedAtMs: number } => s.net != null && Number.isFinite(s.net));

  let freshest: { net: number; observedAtMs: number } | null = null;
  for (const s of valid) if (!freshest || s.observedAtMs > freshest.observedAtMs) freshest = s;

  if (freshest && nowMs - freshest.observedAtMs <= opts.ttlHours * HOUR + 1) {
    return { net: round3(freshest.net), estimated: false, confidence: "high", basis: "fresh" };
  }

  const recent = valid.filter((s) => nowMs - s.observedAtMs <= lookbackHours * HOUR);
  if (recent.length > 0) {
    const net = median(recent.map((s) => s.net))!;
    return { net: round3(net), estimated: true, confidence: recent.length >= 3 ? "medium" : "low", basis: "station_history" };
  }

  if (opts.brandMedian != null && Number.isFinite(opts.brandMedian)) {
    return { net: round3(opts.brandMedian), estimated: true, confidence: "low", basis: "brand" };
  }

  return { net: null, estimated: false, confidence: "low", basis: "none" };
}
