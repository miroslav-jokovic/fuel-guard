import { describe, it, expect } from "vitest";
import { breakFuelAdvice } from "./breakPlan.js";

describe("breakFuelAdvice", () => {
  const avgSpeedMph = 60;

  it("returns nulls when the HOS break clock is unavailable", () => {
    const r = breakFuelAdvice({ timeUntilBreakMs: null, avgSpeedMph, stopsMilesAhead: [100] });
    expect(r).toEqual({ breakDueMiles: null, breakDueHours: null, coincidesStopIndex: null, savesMinutes: 0 });
  });

  it("places the break on the mile axis and pairs the nearest qualifying stop", () => {
    // break due in 4h -> ~240 mi at 60mph. Stops at 100, 250, 500.
    const r = breakFuelAdvice({ timeUntilBreakMs: 4 * 3_600_000, avgSpeedMph, stopsMilesAhead: [100, 250, 500] });
    expect(r.breakDueMiles).toBe(240);
    expect(r.breakDueHours).toBe(4);
    expect(r.coincidesStopIndex).toBe(1); // stop at 250 (within 10mi overshoot + window)
    expect(r.savesMinutes).toBe(30);
  });

  it("does not pair a stop that is far past the break-due mile", () => {
    const r = breakFuelAdvice({ timeUntilBreakMs: 1 * 3_600_000, avgSpeedMph, stopsMilesAhead: [400] });
    expect(r.breakDueMiles).toBe(60);
    expect(r.coincidesStopIndex).toBeNull();
    expect(r.savesMinutes).toBe(0);
  });

  it("prefers an at-or-before stop and the closest within the window", () => {
    // break at 300mi; stops 250 (before, 50 away) and 305 (after, within overshoot, 5 away) -> pick 305.
    const r = breakFuelAdvice({ timeUntilBreakMs: 5 * 3_600_000, avgSpeedMph, stopsMilesAhead: [250, 305] });
    expect(r.breakDueMiles).toBe(300);
    expect(r.coincidesStopIndex).toBe(1);
  });
});
