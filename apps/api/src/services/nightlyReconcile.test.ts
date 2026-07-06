import { describe, it, expect } from "vitest";
import { shouldRunNightly } from "./nightlyReconcile.js";

describe("shouldRunNightly", () => {
  // 2026-07-06T08:00:00Z = 03:00 America/Chicago (CDT, −5).
  const at3amChicago = Date.parse("2026-07-06T08:00:00Z");
  const at7amChicago = Date.parse("2026-07-06T12:00:00Z");

  it("runs at org-local 03:00 when it hasn't run yet", () => {
    expect(shouldRunNightly(at3amChicago, "America/Chicago", null)).toBe(true);
  });

  it("does not run outside the target hour", () => {
    expect(shouldRunNightly(at7amChicago, "America/Chicago", null)).toBe(false);
  });

  it("does not re-run if it already ran within the last 20h (same night)", () => {
    const ranOneHourAgo = new Date(at3amChicago - 3_600_000).toISOString();
    expect(shouldRunNightly(at3amChicago, "America/Chicago", ranOneHourAgo)).toBe(false);
  });

  it("runs again the next night (last run > 20h ago)", () => {
    const ranYesterday = new Date(at3amChicago - 24 * 3_600_000).toISOString();
    expect(shouldRunNightly(at3amChicago, "America/Chicago", ranYesterday)).toBe(true);
  });

  it("uses the org's own timezone (03:00 Eastern ≠ 03:00 Central)", () => {
    // 08:00Z is 03:00 Central but 04:00 Eastern → should NOT run for an Eastern org.
    expect(shouldRunNightly(at3amChicago, "America/New_York", null)).toBe(false);
  });

  it("falls back to UTC for an unknown timezone without throwing", () => {
    const at3amUtc = Date.parse("2026-07-06T03:00:00Z");
    expect(shouldRunNightly(at3amUtc, "Not/AZone", null)).toBe(true);
  });
});
