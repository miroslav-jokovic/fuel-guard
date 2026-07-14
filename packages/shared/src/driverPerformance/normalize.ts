/**
 * Component normalization (pure). Puts each 0–100 sub-score on a common, fleet-relative scale BEFORE the
 * weighted combine, so no single wide-spread metric silently dominates the ranking (§3.3). Percentile is
 * the default for large cohorts; z-score→normal-CDF is a smooth fallback for small cohorts.
 */
import type { NormalizationMethod } from "./types.js";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Hazen mean-rank percentiles (0–100) for each value, ties sharing the mean rank. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const idx = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const meanRank = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]!]! === values[idx[i]!]!) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-based ranks i+1..j+1 → mean
    for (let k = i; k <= j; k++) meanRank[idx[k]!] = avgRank;
    i = j + 1;
  }
  return meanRank.map((rank) => r1((100 * (rank - 0.5)) / n));
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  let p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (z > 0) p = 1 - p;
  return p;
}

/** Map values to 0–100 via z-score → normal CDF (bounded, smooth; robust for small cohorts). */
export function zScoreScaled(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 50); // all equal → neutral middle
  return values.map((v) => r1(normalCdf((v - mean) / std) * 100));
}

/** Normalize a component's values with the chosen method. `raw` returns the values unchanged (rounded). */
export function normalizeComponent(values: number[], method: NormalizationMethod): number[] {
  if (method === "raw") return values.map(r1);
  if (method === "zscore") return zScoreScaled(values);
  return percentileRanks(values);
}
