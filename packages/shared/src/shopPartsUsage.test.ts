import { describe, expect, it } from "vitest";
import { REPEAT_WITHIN_DAYS, isRepeatOnUnit } from "./shopPartsUsage.js";

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
