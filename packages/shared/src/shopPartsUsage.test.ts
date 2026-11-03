import { describe, expect, it } from "vitest";
import {
  REPEAT_WITHIN_DAYS,
  TYPICAL_PRICE_MIN_REPAIRS,
  isPriceWellAbove,
  isRepeatOnUnit,
  typicalPriceOf,
} from "./shopPartsUsage.js";

describe("the same part back on the same unit (D-SPU5)", () => {
  it("is a repeat within the window, inclusive", () => {
    expect(isRepeatOnUnit(REPEAT_WITHIN_DAYS)).toBe(true);
    expect(isRepeatOnUnit(0)).toBe(true);
    expect(isRepeatOnUnit(REPEAT_WITHIN_DAYS + 1)).toBe(false);
  });

  it("a first use, or a use with no unit, is never a repeat", () => {
    expect(isRepeatOnUnit(null)).toBe(false);
  });
});

describe("prices (D-SPU10)", () => {
  it("a typical price needs enough priced repairs behind it", () => {
    expect(typicalPriceOf(43, TYPICAL_PRICE_MIN_REPAIRS)).toBe(43);
    expect(typicalPriceOf(43, TYPICAL_PRICE_MIN_REPAIRS - 1)).toBeNull();
    expect(typicalPriceOf(null, 50)).toBeNull();
  });

  it("well above usual is 1.5× typical or more, and nothing without a typical", () => {
    expect(isPriceWellAbove(150, 100)).toBe(true);
    expect(isPriceWellAbove(149.99, 100)).toBe(false);
    expect(isPriceWellAbove(2082, null)).toBe(false);
    expect(isPriceWellAbove(null, 100)).toBe(false);
    expect(isPriceWellAbove(10, 0)).toBe(false);
  });
});
