import { describe, it, expect } from "vitest";
import { legalDriveMs, combineTeamLegalDriveMs, hosReachableMiles } from "./hos.js";

const H = 3_600_000;
describe("hos", () => {
  it("legal drive = min of the three clocks (shift/cycle can bind)", () => {
    expect(legalDriveMs({ driveRemainingMs: 11 * H, shiftRemainingMs: 5 * H, cycleRemainingMs: 40 * H, timeUntilBreakMs: 8 * H })).toBe(5 * H);
    expect(legalDriveMs({ driveRemainingMs: 2 * H, shiftRemainingMs: 14 * H, cycleRemainingMs: 40 * H, timeUntilBreakMs: 8 * H })).toBe(2 * H);
  });
  it("null when no clocks present", () => {
    expect(legalDriveMs({ driveRemainingMs: null, shiftRemainingMs: null, cycleRemainingMs: null, timeUntilBreakMs: null })).toBeNull();
  });
  it("team combines (sum) driver availabilities", () => {
    const a = { driveRemainingMs: 5 * H, shiftRemainingMs: 6 * H, cycleRemainingMs: 40 * H, timeUntilBreakMs: 8 * H };
    const b = { driveRemainingMs: 8 * H, shiftRemainingMs: 9 * H, cycleRemainingMs: 40 * H, timeUntilBreakMs: 8 * H };
    expect(combineTeamLegalDriveMs([a, b])).toBe(5 * H + 8 * H);
  });
  it("reachable miles = hours x conservative speed", () => {
    expect(hosReachableMiles(10 * H, 55)).toBe(550);
    expect(hosReachableMiles(null)).toBeNull();
  });
});
