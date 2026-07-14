import { describe, it, expect } from "vitest";
import { combineWeek } from "./combine.js";
import { rankTrailing } from "./trailing.js";
import { DEFAULT_PERFORMANCE_SETTINGS } from "./types.js";
import type { PerformanceSettings, DriverWeekInput } from "./types.js";

// raw method + safety-only weights → weekFinal === safetyScore for eligible drivers.
const s = (o: Partial<PerformanceSettings> = {}): PerformanceSettings => ({
  ...DEFAULT_PERFORMANCE_SETTINGS,
  normalizationMethod: "raw",
  minCohortForPercentile: 0,
  weights: { safety: 1, efficiency: 0, idling: 0 },
  ...o,
});
const drv = (id: string, safety: number | null): DriverWeekInput => ({
  driverId: id,
  safetyScore: safety,
  efficiencyScore: null,
  idleScore: null,
  miles: 600,
  driveHours: 12,
});
const byId = (rows: { driverId: string }[]) => Object.fromEntries(rows.map((r) => [r.driverId, r]));

describe("rankTrailing", () => {
  it("averages weekFinal over up to trailingWeeks eligible weeks, ranks, flags winners", () => {
    const set = s({ trailingWeeks: 3, rewardTopN: 2 });
    const wk0 = combineWeek([drv("a", 80), drv("b", 90), drv("c", 70)], set);
    const wk1 = combineWeek([drv("a", 60), drv("b", 90)], set);
    const wk2 = combineWeek([drv("a", 40)], set);
    const rows = rankTrailing([wk0, wk1, wk2], set);
    const by = byId(rows) as Record<string, (typeof rows)[number]>;
    expect(by.a!.trailingFinal).toBe(60); // (80+60+40)/3
    expect(by.a!.weeksCounted).toBe(3);
    expect(by.b!.trailingFinal).toBe(90); // (90+90)/2
    expect(by.c!.trailingFinal).toBe(70); // 70/1
    expect(rows.map((r) => r.driverId)).toEqual(["b", "c", "a"]);
    expect(by.b!.rank).toBe(1);
    expect(by.b!.isWinner).toBe(true);
    expect(by.c!.isWinner).toBe(true);
    expect(by.a!.isWinner).toBe(false);
  });

  it("only ranks drivers eligible in the current week", () => {
    const set = s();
    const wk0 = combineWeek([drv("a", 80)], set);
    const wk1 = combineWeek([drv("z", 99)], set);
    const rows = rankTrailing([wk0, wk1], set);
    expect(rows.map((r) => r.driverId)).toEqual(["a"]);
  });

  it("tie-break: equal trailingFinal → higher current safety pct wins", () => {
    const set = s({ weights: { safety: 0.5, efficiency: 0.5, idling: 0 } });
    const mk = (id: string, safety: number, eff: number): DriverWeekInput => ({
      driverId: id,
      safetyScore: safety,
      efficiencyScore: eff,
      idleScore: null,
      miles: 600,
      driveHours: 12,
    });
    const wk0 = combineWeek([mk("p", 70, 90), mk("q", 90, 70)], set); // both weekFinal 80
    const rows = rankTrailing([wk0], set);
    expect(rows[0]!.driverId).toBe("q");
  });

  it("empty input → []", () => {
    expect(rankTrailing([], s())).toEqual([]);
  });
});
