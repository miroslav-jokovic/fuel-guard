import { describe, it, expect } from "vitest";
import { apportionByWeight } from "./apportion.js";

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe("apportionByWeight — largest remainder (D-FIN11)", () => {
  it("adds back to the pool to the cent where independent rounding does not", () => {
    // 100.00 over three equal weights: 33.33 × 3 = 99.99 under per-row rounding.
    const parts = apportionByWeight(100, [1, 1, 1]);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(sum(parts)).toBe(100);
  });

  it("holds the invariant on an awkward pool and uneven weights", () => {
    const pool = 1443207.52; // June 2026's unallocated pool, as measured in the spec
    const weights = [12345.6, 9876.5, 0, 4321.1, 15000, 1];
    const parts = apportionByWeight(pool, weights);
    expect(sum(parts)).toBe(pool);
    expect(parts[2]).toBe(0); // a zero weight draws nothing
    expect(parts.every((p) => p >= 0)).toBe(true);
  });

  it("gives the leftover cents to the largest fractional parts, earlier index on a tie", () => {
    // 1.00 over four equal weights: 25 cents each, no leftover. 1.01: one extra cent to index 0.
    expect(apportionByWeight(1.01, [1, 1, 1, 1])).toEqual([0.26, 0.25, 0.25, 0.25]);
    // 0.02 over [1, 1, 1]: 0.666 cents each → floors 0, two leftover cents to indices 0 and 1.
    expect(apportionByWeight(0.02, [1, 1, 1])).toEqual([0.01, 0.01, 0]);
  });

  it("apportions nothing when there is nothing to weigh, so the caller reports the pool unallocated", () => {
    expect(apportionByWeight(500, [0, 0])).toEqual([0, 0]);
    expect(apportionByWeight(500, [])).toEqual([]);
    expect(apportionByWeight(0, [1, 2])).toEqual([0, 0]);
    expect(apportionByWeight(-10, [1, 2])).toEqual([0, 0]);
  });

  it("treats a negative weight as zero rather than drawing a negative share", () => {
    const parts = apportionByWeight(10, [-5, 1]);
    expect(parts).toEqual([0, 10]);
  });
});
