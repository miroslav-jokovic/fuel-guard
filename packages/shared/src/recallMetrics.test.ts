import { describe, it, expect } from "vitest";
import { computeRecallMetrics } from "./recallMetrics.js";

describe("computeRecallMetrics", () => {
  it("returns nulls when nothing has been audited", () => {
    const m = computeRecallMetrics({ audited: 0, missed: 0, confirmed: 12, coveredClears: 5000 });
    expect(m.missRate).toBeNull();
    expect(m.estimatedRecall).toBeNull();
    expect(m.recallLow).toBeNull();
  });

  it("extrapolates the sampled miss rate into an estimated recall + range", () => {
    // Audited 100 clears, found 2 misses → 2% miss rate over 5000 covered clears ≈ 100 estimated misses.
    // With 100 confirmed catches: recall ≈ 100 / (100 + 100) = 0.5.
    const m = computeRecallMetrics({ audited: 100, missed: 2, confirmed: 100, coveredClears: 5000 });
    expect(m.missRate).toBe(0.02);
    expect(m.estimatedMisses).toBe(100); // 0.02 × 5000
    expect(m.estimatedRecall).toBe(0.5); // 100 / 200
    // CI widens the range; more misses (CI high) → lower recall, fewer (CI low) → higher recall.
    expect(m.recallLow!).toBeLessThan(0.5);
    expect(m.recallHigh!).toBeGreaterThan(0.5);
    expect(m.missRateCiLow).not.toBeNull();
  });

  it("zero misses in the sample → recall estimate of 1.0 (no evidence of misses)", () => {
    const m = computeRecallMetrics({ audited: 200, missed: 0, confirmed: 40, coveredClears: 3000 });
    expect(m.missRate).toBe(0);
    expect(m.estimatedMisses).toBe(0);
    expect(m.estimatedRecall).toBe(1);
    // But the CI is honest: the upper miss-rate bound implies recall could be lower.
    expect(m.recallLow!).toBeLessThan(1);
  });

  it("no confirmed catches and estimated misses → recall 0", () => {
    const m = computeRecallMetrics({ audited: 50, missed: 5, confirmed: 0, coveredClears: 1000 });
    expect(m.estimatedMisses).toBe(100); // 0.1 × 1000
    expect(m.estimatedRecall).toBe(0); // 0 / (0 + 100)
  });
});
