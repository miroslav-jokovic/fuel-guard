import { describe, it, expect } from "vitest";
import { resolvePerformanceConfig, DEFAULT_PERFORMANCE_SETTINGS } from "./index.js";

describe("resolvePerformanceConfig", () => {
  it("uses defaults + org tz when the row is null", () => {
    const c = resolvePerformanceConfig(null, "America/New_York");
    expect(c.settings).toEqual(DEFAULT_PERFORMANCE_SETTINGS);
    expect(c.weekTimezone).toBe("America/New_York");
    expect(c.weekStartsOn).toBe(1);
    expect(c.settleHours).toBe(96);
    expect(c.efficiencyEnabled).toBe(true);
  });
  it("maps a row (string numerics tolerated) and prefers week_timezone override", () => {
    const c = resolvePerformanceConfig(
      {
        weight_safety: "0.6", weight_efficiency: "0.2", weight_idling: "0.2",
        normalization_method: "zscore", min_cohort_for_percentile: 30,
        min_distance_mi: 250, min_drive_hours: 5, reward_top_n: 5, trailing_weeks: 4,
        settle_hours: 120, efficiency_enabled: false, week_starts_on: 0, week_timezone: "UTC",
      },
      "America/Chicago",
    );
    expect(c.settings.weights).toEqual({ safety: 0.6, efficiency: 0.2, idling: 0.2 });
    expect(c.settings.normalizationMethod).toBe("zscore");
    expect(c.settings.minDistanceMi).toBe(250);
    expect(c.settings.rewardTopN).toBe(5);
    expect(c.settings.trailingWeeks).toBe(4);
    expect(c.weekTimezone).toBe("UTC");
    expect(c.weekStartsOn).toBe(0);
    expect(c.settleHours).toBe(120);
    expect(c.efficiencyEnabled).toBe(false);
  });
  it("falls back to org tz when week_timezone is empty", () => {
    expect(resolvePerformanceConfig({ week_timezone: null }, "America/Denver").weekTimezone).toBe("America/Denver");
  });
});
