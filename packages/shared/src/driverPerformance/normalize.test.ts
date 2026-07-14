import { describe, it, expect } from "vitest";
import { percentileRanks, zScoreScaled, normalizeComponent } from "./normalize.js";

describe("percentileRanks", () => {
  it("Hazen percentiles for distinct values, input order preserved", () => {
    expect(percentileRanks([10, 20, 30, 40])).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(percentileRanks([40, 10, 30, 20])).toEqual([87.5, 12.5, 62.5, 37.5]);
  });
  it("ties share the mean rank", () => {
    expect(percentileRanks([10, 10, 20])).toEqual([33.3, 33.3, 83.3]);
  });
  it("single value → 50; empty → []", () => {
    expect(percentileRanks([7])).toEqual([50]);
    expect(percentileRanks([])).toEqual([]);
  });
});

describe("zScoreScaled", () => {
  it("all-equal → neutral 50", () => {
    expect(zScoreScaled([5, 5, 5])).toEqual([50, 50, 50]);
  });
  it("monotonic and symmetric around the mean", () => {
    const [lo, hi] = zScoreScaled([0, 10]);
    expect(hi!).toBeGreaterThan(lo!);
    expect(lo! + hi!).toBeCloseTo(100, 1);
    expect(hi!).toBeGreaterThan(80);
    expect(lo!).toBeLessThan(20);
  });
  it("empty → []", () => {
    expect(zScoreScaled([])).toEqual([]);
  });
});

describe("normalizeComponent", () => {
  it("raw returns rounded values unchanged", () => {
    expect(normalizeComponent([80.44, 60.06], "raw")).toEqual([80.4, 60.1]);
  });
  it("percentile and zscore dispatch", () => {
    expect(normalizeComponent([10, 20, 30, 40], "percentile")).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(normalizeComponent([5, 5], "zscore")).toEqual([50, 50]);
  });
});
