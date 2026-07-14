import { describe, it, expect } from "vitest";
import { combineWeek } from "./combine.js";
import { DEFAULT_PERFORMANCE_SETTINGS } from "./types.js";
import type { PerformanceSettings, DriverWeekInput } from "./types.js";

const base = (over: Partial<PerformanceSettings> = {}): PerformanceSettings => ({
  ...DEFAULT_PERFORMANCE_SETTINGS,
  ...over,
});
const drv = (id: string, o: Partial<DriverWeekInput> = {}): DriverWeekInput => ({
  driverId: id,
  safetyScore: 80,
  efficiencyScore: 60,
  idleScore: 40,
  miles: 600,
  driveHours: 12,
  ...o,
});
const byId = (rows: { driverId: string }[]) => Object.fromEntries(rows.map((r) => [r.driverId, r]));

describe("combineWeek eligibility gate", () => {
  const s = base({ normalizationMethod: "raw" });
  it("flags below-miles / below-hours / no-safety and keeps raw sub-scores", () => {
    const lb = combineWeek(
      [drv("a", { miles: 400 }), drv("b", { driveHours: 5 }), drv("c", { safetyScore: null }), drv("d")],
      s,
    );
    const by = byId(lb.rows) as Record<string, (typeof lb.rows)[number]>;
    expect(by.a!.ineligibleReason).toBe("below_min_miles");
    expect(by.b!.ineligibleReason).toBe("below_min_hours");
    expect(by.c!.ineligibleReason).toBe("no_safety");
    expect(by.d!.eligible).toBe(true);
    expect(by.a!.eligible).toBe(false);
    expect(by.a!.weekFinal).toBeNull();
    expect(by.a!.safetyScore).toBe(80);
  });
});

describe("combineWeek weighted combine (raw method)", () => {
  const s = base({ normalizationMethod: "raw", minCohortForPercentile: 0 });
  it("weights present components and renormalizes when one is missing", () => {
    const lb = combineWeek([drv("full"), drv("noEff", { efficiencyScore: null })], s);
    const by = byId(lb.rows) as Record<string, (typeof lb.rows)[number]>;
    expect(by.full!.weekFinal).toBe(65); // 0.5*80 + 0.25*60 + 0.25*40
    expect(by.noEff!.weekFinal).toBe(66.7); // (0.5*80 + 0.25*40) / 0.75
    expect(by.noEff!.efficiencyPct).toBeNull();
    expect(lb.coverage).toEqual({ safety: 2, efficiency: 1, idling: 2 });
  });
});

describe("combineWeek normalization method", () => {
  it("falls back to zscore below the percentile cohort floor", () => {
    const lb = combineWeek([drv("a")], base({ normalizationMethod: "percentile", minCohortForPercentile: 20 }));
    expect(lb.methodUsed).toBe("zscore");
  });
  it("keeps percentile above the floor and assigns fleet-relative pct", () => {
    const s = base({ normalizationMethod: "percentile", minCohortForPercentile: 2, weights: { safety: 1, efficiency: 0, idling: 0 } });
    const lb = combineWeek([drv("lo", { safetyScore: 10 }), drv("mid", { safetyScore: 50 }), drv("hi", { safetyScore: 90 })], s);
    const by = byId(lb.rows) as Record<string, (typeof lb.rows)[number]>;
    expect(lb.methodUsed).toBe("percentile");
    expect(by.lo!.safetyPct).toBe(16.7);
    expect(by.mid!.safetyPct).toBe(50);
    expect(by.hi!.safetyPct).toBe(83.3);
    expect(by.hi!.weekFinal).toBe(83.3);
  });
});

describe("combineWeek renormalizes over present components", () => {
  it("drops a null idle component and renormalizes over safety+efficiency", () => {
    const s = base({ normalizationMethod: "raw", minCohortForPercentile: 0, weights: { safety: 0.5, efficiency: 0.25, idling: 0.25 } });
    const lb = combineWeek([drv("a", { idleScore: null })], s);
    const r = lb.rows[0]!;
    expect(r.idlePct).toBeNull();
    // (0.5*80 + 0.25*60) / (0.5 + 0.25) = 73.3
    expect(r.weekFinal).toBe(73.3);
    expect(lb.coverage).toEqual({ safety: 1, efficiency: 1, idling: 0 });
  });
});
