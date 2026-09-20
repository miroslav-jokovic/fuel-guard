import { describe, expect, it } from "vitest";
import { niceScale } from "./niceScale";

describe("niceScale", () => {
  /**
   * The case that motivated it: a month of this carrier's fuel spend. Chart.js drew
   * `$15.3K / $30.7K / $46K / $61.3K` from the same number.
   */
  it("turns the spend series that produced $15.3K steps into round twenties", () => {
    const { max, stepSize } = niceScale(61_300);
    expect(stepSize).toBe(20_000);
    expect(max).toBe(80_000);
    // Every label on the axis, which is what a reader actually sees.
    const labels = Array.from({ length: max / stepSize + 1 }, (_, i) => i * stepSize);
    expect(labels).toEqual([0, 20_000, 40_000, 60_000, 80_000]);
  });

  it("keeps every step on the 1 / 2 / 2.5 / 5 ladder across six decades", () => {
    for (const dataMax of [3, 27, 240, 2_300, 61_300, 940_000]) {
      const { stepSize } = niceScale(dataMax);
      const decade = 10 ** Math.floor(Math.log10(stepSize));
      expect([1, 2, 2.5, 5, 10]).toContain(Number((stepSize / decade).toFixed(2)));
    }
  });

  /**
   * What the 2.5 rung actually buys, measured rather than assumed: the number of INTERVALS the
   * caller asked for. A series topping out at 880 wants a rough step of 220; the ladder's 250 gives
   * four intervals (0/250/500/750/1000), and without that rung the next rung up is 500, which gives
   * two. The axis maximum is 1,000 either way — the first draft of this test claimed 2.5 rescued the
   * plot's HEIGHT and that was wrong.
   */
  it("keeps the requested interval count instead of halving it", () => {
    const { max, stepSize } = niceScale(880);
    expect(stepSize).toBe(250);
    expect(max / stepSize).toBe(4);
  });

  it("never returns a zero-height axis for an empty series", () => {
    for (const empty of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { max, stepSize } = niceScale(empty);
      expect(max).toBeGreaterThan(0);
      expect(stepSize).toBeGreaterThan(0);
    }
  });

  it("covers the data — the axis maximum is never below it", () => {
    for (const dataMax of [1, 9.4, 61_300, 61_301, 99_999]) {
      expect(niceScale(dataMax).max).toBeGreaterThanOrEqual(dataMax);
    }
  });
});
