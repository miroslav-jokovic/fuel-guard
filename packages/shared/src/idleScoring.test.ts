import { describe, it, expect } from "vitest";
import {
  classifyIdleEvent,
  aggregateDriverIdle,
  milliCToF,
  mlToGal,
  parseIdlingEvents,
  learnComfortBand,
  topAvoidableIdles,
  type IdleRow,
  type LongIdleInput,
} from "./idleScoring.js";

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
  it("rejects a valley sitting on an edge bin (only one climate tail seen — audit A1.6)", () => {
    // Idle falls monotonically as it warms: heavy in the cold, light at the hot end → the min-idle bin is the
    // hottest (edge). We only saw the cold tail, so no interior comfort valley → null.
    const events: { tempF: number; hours: number }[] = [];
    for (let i = 0; i < 15; i++) events.push({ tempF: 10 + (i % 3) * 5, hours: 5 }); // cold, heavy
    for (let i = 0; i < 15; i++) events.push({ tempF: 80 + (i % 3) * 5, hours: 0.2 }); // hot, light (edge min)
    expect(learnComfortBand(events)).toBeNull();
  });
  it("rejects a too-narrow valley that would over-classify idle as discretionary (audit A1.6)", () => {
    // Heavy idle on both sides of a single low-idle bin → the raw valley is only ~5°F wide. Adopting it would
    // make almost all idle 'discretionary', so it must not be suggested.
    const events: { tempF: number; hours: number }[] = [];
    for (let i = 0; i < 15; i++) events.push({ tempF: 50, hours: 5 }); // cold-side tail
    for (let i = 0; i < 15; i++) events.push({ tempF: 60, hours: 5 }); // hot-side tail
    events.push({ tempF: 55, hours: 0.2 }); // lone low-idle bin between them
    expect(learnComfortBand(events)).toBeNull();
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
    expect(e).toMatchObject({
      eventUuid: "abc",
      durationSec: 3600,
      assetId: "123",
      operatorId: "456",
      ptoActive: false,
      airTempF: 70,
      fuelGal: 1,
      costUsd: 3.2,
      geofenceTypes: ["yard"],
    });
  });
  it("handles a missing operator (unassigned) and missing temperature", () => {
    const [e] = parseIdlingEvents({
      data: [
        {
          eventUuid: "x",
          startTime: "2026-07-08T04:00:00Z",
          durationMilliseconds: 600000,
          asset: { id: 1 },
        },
      ],
    });
    expect(e!.operatorId).toBeNull();
    expect(e!.airTempF).toBeNull();
  });
});

describe("classifyIdleEvent", () => {
  it("ignores short stops as 'brief'", () => {
    expect(classifyIdleEvent({ durationSec: 120, ptoActive: false, airTempF: 70 })).toBe("brief");
  });
  it("treats PTO-active idle as productive", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: true, airTempF: 70 })).toBe(
      "productive",
    );
  });
  it("justifies idle in extreme cold or heat", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 5 })).toBe(
      "justified",
    );
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 95 })).toBe(
      "justified",
    );
  });
  it("flags comfortable-weather engine idle as discretionary (avoidable)", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 68 })).toBe(
      "discretionary",
    );
  });
  it("treats unknown temperature as discretionary (no justification available)", () => {
    expect(classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: null })).toBe(
      "discretionary",
    );
  });
  it("does NOT excuse extreme-temp idle on an APU truck — should have used the APU (audit A1.3)", () => {
    // Same freezing fill: a no-APU (or unknown) truck is justified; an APU truck is discretionary.
    expect(
      classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 5, hasApu: false }),
    ).toBe("justified");
    expect(
      classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 5, hasApu: null }),
    ).toBe("justified");
    expect(
      classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 5, hasApu: true }),
    ).toBe("discretionary");
    expect(
      classifyIdleEvent({ durationSec: 3600, ptoActive: false, airTempF: 95, hasApu: true }),
    ).toBe("discretionary");
  });
  it("still treats PTO idle on an APU truck as productive (equipment work, not the driver's waste)", () => {
    expect(
      classifyIdleEvent({ durationSec: 3600, ptoActive: true, airTempF: 5, hasApu: true }),
    ).toBe("productive");
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
    driverId: "d1",
    driverName: "John Smith",
    durationSec: 3600,
    classification: "discretionary",
    fuelGal: null,
    costUsd: null,
    ...o,
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
    const s = aggregateDriverIdle([
      row({ classification: "discretionary", fuelGal: 2, costUsd: 9.5 }),
    ]);
    expect(s.drivers[0]!.discretionaryGal).toBe(2);
    expect(s.drivers[0]!.discretionaryCost).toBe(9.5);
  });

  it("score is 100 with no avoidable idle and drops with discretionary share", () => {
    const clean = aggregateDriverIdle([
      row({ classification: "productive" }),
      row({ classification: "justified" }),
    ]);
    expect(clean.drivers[0]!.score).toBe(100);
    // Half discretionary, half justified → 50% discretionary share → score ~50.
    const mixed = aggregateDriverIdle([
      row({ classification: "discretionary" }),
      row({ classification: "justified" }),
    ]);
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
    const s = aggregateDriverIdle([
      row({ driverId: null, driverName: null, classification: "discretionary" }),
    ]);
    expect(s.drivers[0]!.driverName).toBe("Unattributed");
  });

  it("reports the attributed share of discretionary $ (audit A1.5)", () => {
    const s = aggregateDriverIdle([
      row({ driverId: "a", driverName: "A", classification: "discretionary" }), // $3.20 attributed
      row({ driverId: null, driverName: null, classification: "discretionary" }), // $3.20 unattributed
    ]);
    expect(s.unattributedDiscretionaryCost).toBe(3.2);
    expect(s.attributedPct).toBe(50);
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
    driverName: "John Smith",
    unitNumber: "712",
    startedAt: "2026-07-08T04:00:00Z",
    durationSec: 36000,
    classification: "discretionary",
    costUsd: null,
    fuelGal: null,
    hasApu: true,
    idleCapability: "apu",
    ...o,
  });

  it("surfaces long discretionary idles, avoidable (APU truck) first — driven by the manual has_apu flag", () => {
    const rows = topAvoidableIdles([
      li({ unitNumber: "A", durationSec: 18000, hasApu: false }), // 5 h, no APU → not avoidable
      li({ unitNumber: "B", durationSec: 10800, hasApu: true }), // 3 h, has APU → avoidable
      li({ unitNumber: "C", durationSec: 3600, hasApu: true }), // 1 h → below minHours
    ]);
    expect(rows.map((r) => r.unitNumber)).toEqual(["B", "A"]); // avoidable first, 1 h dropped
    expect(rows[0]!.avoidable).toBe(true);
    expect(rows[1]!.avoidable).toBe(false);
  });

  it("never calls an idle avoidable when the truck's APU status is unknown (null)", () => {
    // Even if the LEARNED capability guessed 'apu', an unset manual flag must not accuse the driver.
    const rows = topAvoidableIdles([li({ hasApu: null, idleCapability: "apu" })]);
    expect(rows[0]!.avoidable).toBe(false);
    expect(rows[0]!.hasApu).toBeNull();
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

  it("labels equipment for the coaching list and never calls optimized-idle avoidable", () => {
    const rows = topAvoidableIdles([
      li({ unitNumber: "APU", hasApu: true }),
      li({ unitNumber: "OPT", hasApu: false, hasOptimizedIdle: true }),
      li({ unitNumber: "NONE", hasApu: false, hasOptimizedIdle: false }),
      li({ unitNumber: "UNK", hasApu: null, hasOptimizedIdle: null }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.unitNumber, r]));
    expect(by.APU!.equipment).toBe("apu");
    expect(by.APU!.avoidable).toBe(true);
    // OEM optimized idle: the engine cycling is the feature, not driver waste → never "avoidable".
    expect(by.OPT!.equipment).toBe("optimized_idle");
    expect(by.OPT!.avoidable).toBe(false);
    expect(by.NONE!.equipment).toBe("none");
    expect(by.UNK!.equipment).toBe("unknown");
  });
});
