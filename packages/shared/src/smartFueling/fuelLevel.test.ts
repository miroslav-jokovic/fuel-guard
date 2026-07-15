import { describe, it, expect } from "vitest";
import { smoothFuelPercent, effectiveTankCapacityGal, gallonsOnHand } from "./fuelLevel.js";

const s = (value: number) => ({ time: "2026-07-15T14:00:00Z", value });

describe("fuelLevel", () => {
  it("rolling median ignores a single spike", () => {
    expect(smoothFuelPercent([50, 51, 52, 99, 51, 50, 52].map(s))).toBe(51); // spike doesn't move the median
  });
  it("returns null with no samples, a value with one", () => {
    expect(smoothFuelPercent([])).toBeNull();
    expect(smoothFuelPercent([s(68)])).toBe(68);
  });
  it("effective capacity prefers observed max fill when larger", () => {
    expect(effectiveTankCapacityGal(120, 240)).toBe(240);
    expect(effectiveTankCapacityGal(120, 100)).toBe(120);
    expect(effectiveTankCapacityGal(120, null)).toBe(120);
  });
  it("gallons on hand = pct of effective capacity", () => {
    expect(gallonsOnHand(50, 200)).toBe(100);
    expect(gallonsOnHand(null, 200)).toBeNull();
  });
});
