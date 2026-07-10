import { describe, it, expect } from "vitest";
import { classifyIdleEvent, aggregateDriverIdle, milliCToF, mlToGal, parseIdlingEvents, learnComfortBand, topAvoidableIdles, type IdleRow, type LongIdleInput } from "./idleScoring.js";

describe("learnComfortBand", () => {
  it("finds the low-idle valley between the cold and hot climate tails", () => {
    const events: { tempF: number; hours: number }[] = [];
    // Heavy idle in the cold (10–25°F) and hot (90–100°F) tails; little in the 50–75°F middle.
    for (let i = 0; i < 20; i++) events.push({ tempF: 10 + (i % 4) * 5, hours: 4 }); // cold, lots
    for (let i = 0; i < 20; i++) events.push({ tempF: 90 + (i % 3) * 5, hours: 4 }); // hot, lots
    for (let i = 0; i < 20; i++) events.push({ tempF: 55 + (i % 4) * 5, hours: 0.3 }); // comfortable, little
    const band = learnComfortBand(events);
    expect(band).not.toBeNull();
    expect(band!.lowF).toBeGreaterThanOrEqual(30);
    expect(band!.highF).toBeLessThanOrEqual(90);
    expect(band!.lowF).toBeLessThan(band!.highF);
  });
  it("returns null until there is enough data", () => {
    expect(learnComfortBand([{ tempF: 60, hours: 1 }])).toBeNull();
  });
});

describe("parseIdlingEvents", () => {
  it("normalizes a Samsara idle event (units + optional driver)", () => {
    const [e] = parseIdlingEvents({
      data: [
        {
          eventUuid: "abc",
          startTime: "2026-07-08T04:00:00Z",
          durationMilliseconds: 3_600_000,
          asset: { id: 123 },
          operator: { id: 456 },
          ptoState: "inactive",
          airTemperatureMillicelsius: 21000, // ~70°F
          fuelConsumedMilliliters: 3785.411784, // 1 gal
          fuelCost: { amount: "3.20" },
          latitude: 41.5,
          longitude: -87.9,
          address: { addressTypes: ["yard"] },
        },
      ],
    });
    expect(e).toMatchObject({ eventUuid: "abc", durationSec: 3600, assetId: "123", operatorId: "456", ptoActive: false, airTempF: 70, fuelGal: 1, costUsd: 3.2, geofenceTypes: ["yard"] });
  });
  it("handles a missing operator (unassigned) and missing temperature", () => {
    const [e] = parseIdlingEvents({ data: [{ eventUuid: "x", startTime: "2026-07-08T04:00:00Z", durationMilliseconds: 600000, asset: { id: 1 } }] });
    expect(e!.operatorId).toBeNull();
    expect(e!.airTempF).toBeNull();
  });
});

describe("classifyIdleEvent", () => {
  it("ignores short stops as 'brief'", () => {
    expect(classifyIdleEvent({ durationSec: 120, ptoActive: false, airTempF: 70 })).toBe("brief");
  });
  it("treats PTO-active idle as productive", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: true, airTempF: 70 })).toBe("productive");
  });
  it("justifies idle in extreme cold or heat", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 5 })).toBe("justified");
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 95 })).toBe("justified");
  });
  it("flags comfortable-weather engine idle as discretionary (avoidable)", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 68 })).toBe("discretionary");
  });
  it("treats unknown temperature as discretionary (no justification available)", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: null })).toBe("discretionary");
  });
});

describe("unit conversions", () => {
  it("milliCelsius → °F", () => {
    expect(milliCToF(0)).toBe(32);
    expect(milliCToF(37000)).toBe(99); // 37°C
    expect(milliCToF(null)).toBeNull();
  });
  it("milliliters → gallons", () => {
    expect(mlToGal(3785.411784)).toBe(1);
    expect(mlToGal(null)).toBeNull();
  });
});

describe("aggregateDriverIdle", () => {
  const row = (o: Partial<IdleRow>): IdleRow => ({
    driverId: "d1", driverName: "John Smith", durationSec: 3600, classification: "discretionary", fuelGal: null, costUsd: null, ...o,
  });

  it("scores only discretionary idle and estimates fuel $ when unmeasured", () => {
    const s = aggregateDriverIdle([
      row({ durationSec: 3600, classification: "discretionary" }), // 1 h → 0.8 gal → $3.20 at defaults
      row({ durationSec: 3600, classification: "productive" }),
      row({ durationSec: 3600, classification: "justified" }),
      row({ durationSec: 60, classification: "brief" }), // ignored
    ]);
    const d = s.drivers[0]!;
    expect(d.discretionaryHours).toBe(1);
    expect(d.discretionaryGal).toBe(0.8);
    expect(d.discretionaryCost).toBe(3.2);
    expect(d.productiveHours).toBe(1);
    expect(d.justifiedHours).toBe(1);
    expect(d.events).toBe(3); // brief excluded
    expect(s.fleetDiscretionaryCost).toBe(3.2);
  });

  it("uses measured fuel/cost when present", () => {
    const s = aggregateDriverIdle([row({ classification: "discretionary", fuelGal: 2, costUsd: 9.5 })]);
    expect(s.drivers[0]!.discretionaryGal).toBe(2);
    expect(s.drivers[0]!.discretionaryCost).toBe(9.5);
  });

  it("score is 100 with no avoidable idle and drops with discretionary share", () => {
    const clean = aggregateDriverIdle([row({ classification: "productive" }), row({ classification: "justified" })]);
    expect(clean.drivers[0]!.score).toBe(100);
    // Half discretionary, half justified → 50% discretionary share → score ~50.
    const mixed = aggregateDriverIdle([row({ classification: "discretionary" }), row({ classification: "justified" })]);
    expect(mixed.drivers[0]!.discretionaryPct).toBe(50);
    expect(mixed.drivers[0]!.score).toBe(50);
  });

  it("ranks the biggest $ waster first and counts long idles", () => {
    const s = aggregateDriverIdle([
      row({ driverId: "a", driverName: "A", durationSec: 36000, classification: "discretionary" }), // 10 h
      row({ driverId: "b", driverName: "B", durationSec: 3600, classification: "discretionary" }), // 1 h
    ]);
    expect(s.drivers[0]!.driverName).toBe("A");
    expect(s.drivers[0]!.longIdleCount).toBe(1);
  });

  it("buckets unattributed idle under a single row", () => {
    const s = aggregateDriverIdle([row({ driverId: null, driverName: null, classification: "discretionary" })]);
    expect(s.drivers[0]!.driverName).toBe("Unattributed");
  });

  it("computes a week-over-week discretionary trend from event dates", () => {
    const now = Date.parse("2026-07-10T00:00:00Z");
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
    // Improving driver: 10 h prior week, 1 h recent week → "down".
    const improving = aggregateDriverIdle(
      [
        row({ driverId: "a", driverName: "A", durationSec: 36000, startedAt: daysAgo(10) }),
        row({ driverId: "a", driverName: "A", durationSec: 3600, startedAt: daysAgo(2) }),
      ],
      { nowMs: now },
    );
    expect(improving.drivers[0]!.priorDiscHours).toBe(10);
    expect(improving.drivers[0]!.recentDiscHours).toBe(1);
    expect(improving.drivers[0]!.trend).toBe("down");
    // Worsening driver: 1 h prior, 10 h recent → "up".
    const worse = aggregateDriverIdle(
      [
        row({ driverId: "b", driverName: "B", durationSec: 3600, startedAt: daysAgo(10) }),
        row({ driverId: "b", driverName: "B", durationSec: 36000, startedAt: daysAgo(2) }),
      ],
      { nowMs: now },
    );
    expect(worse.drivers[0]!.trend).toBe("up");
  });

  it("marks trend 'na' when there is no dated activity in either window", () => {
    const s = aggregateDriverIdle([row({ classification: "discretionary" })]); // no startedAt
    expect(s.drivers[0]!.trend).toBe("na");
  });
});

describe("topAvoidableIdles", () => {
  const li = (o: Partial<LongIdleInput>): LongIdleInput => ({
    driverName: "John Smith", unitNumber: "712", startedAt: "2026-07-08T04:00:00Z",
    durationSec: 36000, classification: "discretionary", costUsd: null, fuelGal: null, idleCapability: "apu", ...o,
  });

  it("surfaces long discretionary idles, avoidable (APU/optimized) first", () => {
    const rows = topAvoidableIdles([
      li({ unitNumber: "A", durationSec: 18000, idleCapability: "continuous_only" }), // 5 h, not avoidable
      li({ unitNumber: "B", durationSec: 10800, idleCapability: "apu" }), // 3 h, avoidable
      li({ unitNumber: "C", durationSec: 3600, idleCapability: "ecu_optimized" }), // 1 h → below minHours
    ]);
    expect(rows.map((r) => r.unitNumber)).toEqual(["B", "A"]); // avoidable first, 1 h dropped
    expect(rows[0]!.avoidable).toBe(true);
    expect(rows[1]!.avoidable).toBe(false);
  });

  it("excludes non-discretionary idle and estimates cost when unmeasured", () => {
    const rows = topAvoidableIdles([
      li({ classification: "productive" }),
      li({ classification: "justified" }),
      li({ durationSec: 36000, costUsd: null, fuelGal: null }), // 10 h → 8 gal → $32 at defaults
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costUsd).toBe(32);
  });
});
