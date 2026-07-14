import { describe, it, expect } from "vitest";
import { parseSafetyScores, parseDriverEfficiency, parseEfficiencyOverall } from "./parse.js";

describe("parseSafetyScores", () => {
  it("maps a full record with harsh/crash counts and speeding sum", () => {
    const rows = parseSafetyScores({
      data: [
        {
          driverId: 1234,
          driverScore: 97,
          driveDistanceMeters: 1609344, // 1000 mi
          driveTimeMilliseconds: 3_600_000, // 1 h
          behaviors: [
            { behaviorType: "acceleration", count: 2 },
            { behaviorType: "braking", count: 3 },
            { behaviorType: "harshTurn", count: 1 },
            { behaviorType: "crash", count: 0 },
          ],
          speeding: [{ durationMilliseconds: 1000 }, { durationMilliseconds: 500 }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.samsaraDriverId).toBe("1234");
    expect(r.safetyScore).toBe(97);
    expect(r.driveDistanceMi).toBe(1000);
    expect(r.driveTimeHours).toBe(1);
    expect(r.harshAccelCount).toBe(2);
    expect(r.harshBrakeCount).toBe(3);
    expect(r.harshTurnCount).toBe(1);
    expect(r.crashCount).toBe(0);
    expect(r.speedingMs).toBe(1500);
  });

  it("skips records without a driverId and tolerates empty/missing data", () => {
    expect(parseSafetyScores({ data: [{ driverScore: 90 }] })).toEqual([]);
    expect(parseSafetyScores({ data: [] })).toEqual([]);
    expect(parseSafetyScores(null)).toEqual([]);
    expect(parseSafetyScores({})).toEqual([]);
  });

  it("nulls a missing score and absent exposure", () => {
    const r = parseSafetyScores({ data: [{ driverId: "9" }] })[0]!;
    expect(r.safetyScore).toBeNull();
    expect(r.driveDistanceMi).toBeNull();
    expect(r.driveTimeHours).toBeNull();
    expect(r.harshBrakeCount).toBe(0);
  });
});

describe("parseEfficiencyOverall", () => {
  it("parses numeric strings and numbers", () => {
    expect(parseEfficiencyOverall("87")).toEqual({ score: 87, letter: null });
    expect(parseEfficiencyOverall("0")).toEqual({ score: 0, letter: null });
    expect(parseEfficiencyOverall(92)).toEqual({ score: 92, letter: null });
  });
  it("keeps A–G letter grades as a letter (score null) for graceful degrade", () => {
    expect(parseEfficiencyOverall("A")).toEqual({ score: null, letter: "A" });
    expect(parseEfficiencyOverall("g")).toEqual({ score: null, letter: "G" });
  });
  it("returns nulls for empty/unknown", () => {
    expect(parseEfficiencyOverall("")).toEqual({ score: null, letter: null });
    expect(parseEfficiencyOverall(null)).toEqual({ score: null, letter: null });
    expect(parseEfficiencyOverall("xyz")).toEqual({ score: null, letter: null });
  });
});

describe("parseDriverEfficiency", () => {
  it("maps score + raw engine-on hours + idling %", () => {
    const r = parseDriverEfficiency({
      data: [
        {
          driverId: "88",
          scoreData: { overallScore: "90" },
          rawData: { engineOnDurationMs: 7_200_000 }, // 2 h
          percentageData: { idlingPercentage: 12.34 },
        },
      ],
    })[0]!;
    expect(r.samsaraDriverId).toBe("88");
    expect(r.efficiencyScore).toBe(90);
    expect(r.efficiencyGradeLetter).toBeNull();
    expect(r.engineOnHours).toBe(2);
    expect(r.idlingPct).toBe(12.3);
  });
  it("degrades a letter grade to null score + stored letter", () => {
    const r = parseDriverEfficiency({
      data: [{ driverId: "5", scoreData: { overallScore: "B" } }],
    })[0]!;
    expect(r.efficiencyScore).toBeNull();
    expect(r.efficiencyGradeLetter).toBe("B");
  });
});
