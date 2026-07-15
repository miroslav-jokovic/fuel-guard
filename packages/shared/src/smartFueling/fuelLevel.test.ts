import { describe, it, expect } from "vitest";
import { currentFuelPercent, effectiveTankCapacityGal, gallonsOnHand } from "./fuelLevel.js";

const s = (value: number) => ({ time: "2026-07-15T14:00:00Z", value });

describe("fuelLevel", () => {
  it("trusts the latest reading when the prior sample corroborates it", () => {
    expect(currentFuelPercent([50, 51, 52, 51, 50, 52, 52].map(s))).toBe(52); // steady → current gauge
  });
  it("reflects a fill immediately once it has settled (no lag)", () => {
    // Truck fueled: recent samples are all post-fill high; must read ~full, not the old pre-fill level.
    expect(currentFuelPercent([8, 8, 8, 8, 99, 99, 99].map(s))).toBe(99);
  });
  it("reflects a fill even when only the newest sample is post-fill (sparse data)", () => {
    expect(currentFuelPercent([8, 8, 8, 8, 8, 8, 99].map(s))).toBe(99); // upward jump = fueling → trust it
  });
  it("rejects a single downward glitch at the tail", () => {
    expect(currentFuelPercent([50, 50, 50, 50, 50, 50, 12].map(s))).toBe(50); // lone low glitch → median, not 12
  });
  it("returns null with no samples, the latest with one", () => {
    expect(currentFuelPercent([])).toBeNull();
    expect(currentFuelPercent([s(68)])).toBe(68);
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
