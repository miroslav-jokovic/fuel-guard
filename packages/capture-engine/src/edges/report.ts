import type { Quad } from "../enhance/homography";
import type { LabelEntry } from "./labels";
import { smartDocJaccard, worstCornerError } from "./score";

/**
 * From one detector's answers on a labelled set to the numbers the plan decides with
 * (LIVE-EDGE-DETECTION-PLAN.md §4.4, Q-LED3).
 */

/**
 * The proposed bar (Q-LED3 — proposed, NOT yet accepted by the owner, and to be reset after the first
 * baseline). One place, so a report and the plan cannot disagree about what "passes" means.
 */
export const PRECISION_BAR = {
  /** Median worst-corner error, px at SCORE_LONG_EDGE. */
  medianWorstCornerPx: 2,
  /** 95th-percentile worst-corner error, px at SCORE_LONG_EDGE. */
  p95WorstCornerPx: 6,
  /** Share of photos WITH a document where no outline was found. */
  maxMissRate: 0.02,
  /** Outlines drawn on photos with NO document. */
  maxFalseOutlines: 0,
} as const;

export interface CaseResult {
  id: string;
  tags: Record<string, string>;
  hasDocument: boolean;
  found: boolean;
  /** Present when the photo has a document; 0 when nothing was found. */
  jaccard?: number;
  /** Present when the photo has a document AND an outline was found. */
  worstCornerPx?: number;
}

export function scoreCase(entry: LabelEntry, found: Quad | null): CaseResult {
  const base = { id: entry.id, tags: entry.tags, hasDocument: entry.document !== null, found: found !== null };
  if (!entry.document) return base;
  const jaccard = smartDocJaccard(entry.document.corners, found);
  if (!found) return { ...base, jaccard };
  return { ...base, jaccard, worstCornerPx: worstCornerError(entry.document.corners, found, Math.max(entry.width, entry.height)) };
}

export interface Summary {
  photos: number;
  withDocument: number;
  missed: number;
  missRate: number;
  falseOutlines: number;
  jaccardMean: number;
  jaccardMedian: number;
  jaccardP5: number;
  worstCornerMedianPx: number;
  worstCornerP95Px: number;
  bar: { median: boolean; p95: boolean; miss: boolean; falseOutlines: boolean; all: boolean };
}

/** Nearest-rank percentile (p in 0–100) of an ascending-sorted list; NaN for an empty one. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function summarise(results: readonly CaseResult[]): Summary {
  const docs = results.filter((r) => r.hasDocument);
  const missed = docs.filter((r) => !r.found).length;
  const falseOutlines = results.filter((r) => !r.hasDocument && r.found).length;
  const jaccards = docs.map((r) => r.jaccard ?? 0).sort((a, b) => a - b);
  // Corner error only exists where an outline was found; misses are counted by `missRate` instead of
  // being folded in as an infinite error, so each number says one thing.
  const corners = docs.filter((r) => r.worstCornerPx !== undefined).map((r) => r.worstCornerPx!).sort((a, b) => a - b);
  const missRate = docs.length ? missed / docs.length : 0;
  const median = percentile(corners, 50);
  const p95 = percentile(corners, 95);
  const bar = {
    median: median <= PRECISION_BAR.medianWorstCornerPx,
    p95: p95 <= PRECISION_BAR.p95WorstCornerPx,
    miss: missRate <= PRECISION_BAR.maxMissRate,
    falseOutlines: falseOutlines <= PRECISION_BAR.maxFalseOutlines,
  };
  return {
    photos: results.length,
    withDocument: docs.length,
    missed,
    missRate,
    falseOutlines,
    jaccardMean: jaccards.length ? jaccards.reduce((s, v) => s + v, 0) / jaccards.length : Number.NaN,
    jaccardMedian: percentile(jaccards, 50),
    jaccardP5: percentile(jaccards, 5),
    worstCornerMedianPx: median,
    worstCornerP95Px: p95,
    bar: { ...bar, all: bar.median && bar.p95 && bar.miss && bar.falseOutlines },
  };
}

/** The same summary for every value of one tag ("surface", "light", "set" …), so a weakness has an address. */
export function summariseBy(results: readonly CaseResult[], tag: string): Map<string, Summary> {
  const groups = new Map<string, CaseResult[]>();
  for (const r of results) {
    const key = r.tags[tag] ?? "(untagged)";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, summarise(v)]));
}
