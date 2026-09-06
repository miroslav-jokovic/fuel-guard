import { describe, it, expect } from "vitest";
import { changeTone, formatPercentChange, percentChange } from "./periodChange";

/**
 * The change-against-last-period arithmetic (D-FRUI3). What matters is the refusals — no previous
 * figure, a previous figure of zero — and that the tone follows the caller's idea of "good", not
 * the sign alone: a rise in spending is red, a rise in earnings is green.
 */
describe("periodChange", () => {
  it("computes a signed change against the previous figure", () => {
    expect(percentChange(1_473_728.93, 770_045.86)).toBeCloseTo(-47.75, 1);
    expect(percentChange(3_634_060.11, 4_058_143.38)).toBeCloseTo(11.67, 1);
  });

  it("measures the change against the previous figure's size even when it was negative", () => {
    // January lost $352k; February kept $87k — up by 125% of January's size, not down.
    expect(percentChange(-352_217.64, 87_129.57)).toBeCloseTo(124.7, 0);
  });

  it("refuses when there is no previous figure or it was zero", () => {
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(undefined, 100)).toBeNull();
    expect(percentChange(0, 100)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
  });

  it("formats with a real minus sign and one decimal", () => {
    expect(formatPercentChange(-47.75)).toBe("−47.8%");
    expect(formatPercentChange(11.67)).toBe("+11.7%");
    expect(formatPercentChange(0)).toBe("0.0%");
  });

  it("colours by whether the move was wanted, not by its sign", () => {
    expect(changeTone(11.7, false)).toBe("text-danger-700"); // spending rose
    expect(changeTone(11.7, true)).toBe("text-success-700"); // earnings rose
    expect(changeTone(-47.7, true)).toBe("text-danger-700"); // kept fell
    expect(changeTone(-5, false)).toBe("text-success-700"); // spending fell
    expect(changeTone(0, true)).toBe("text-ink-tertiary");
    expect(changeTone(null, true)).toBe("text-ink-tertiary");
  });
});
