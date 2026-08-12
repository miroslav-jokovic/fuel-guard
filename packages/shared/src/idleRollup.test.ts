import { describe, it, expect } from "vitest";
import { buildIdleRollupDays } from "./idleRollup.js";
import type { HosSegment } from "./hos.js";

const T0 = Date.parse("2026-06-01T00:00:00.000Z"); // day boundary
const H = 3600_000;
const D1 = "2026-06-01";
const D2 = "2026-06-02";

const win = { windowStartMs: T0, windowEndMs: T0 + 10 * 86_400_000 };

describe("buildIdleRollupDays", () => {
  it("passes engine-day totals through and splits session idle by mode on the start day", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 3600, idleSec: 1800, offSec: 600, coverageSec: 6000 },
      ],
      sessions: [
        { vehicleId: "v1", startedAtMs: T0 + 2 * H, idleSec: 900, mode: "continuous" },
        { vehicleId: "v1", startedAtMs: T0 + 5 * H, idleSec: 300, mode: "apu_or_off" },
        { vehicleId: "v1", startedAtMs: T0 + 6 * H, idleSec: 200, mode: "optimized_cycling" },
      ],
      events: [],
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vehicleId: "v1",
      day: D1,
      driveSec: 3600,
      idleSec: 1800,
      offSec: 600,
      coverageSec: 6000,
      continuousIdleSec: 900,
      managedIdleSec: 500, // apu_or_off + optimized_cycling
      attributedDriverId: null,
    });
  });

  it("scales independently synced session buckets to observed day idle", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        {
          vehicleId: "v1",
          day: D1,
          driveSec: 0,
          idleSec: 4 * 3600,
          offSec: 0,
          coverageSec: 4 * 3600,
        },
      ],
      sessions: [
        { vehicleId: "v1", startedAtMs: T0 + H, idleSec: 5 * 3600, mode: "continuous" },
        { vehicleId: "v1", startedAtMs: T0 + 2 * H, idleSec: 3 * 3600, mode: "apu_or_off" },
      ],
      events: [],
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    expect(rows[0]).toMatchObject({
      idleSec: 4 * 3600,
      continuousIdleSec: 2 * 3600 + 30 * 60,
      managedIdleSec: 1 * 3600 + 30 * 60,
    });
    expect(rows[0]!.continuousIdleSec + rows[0]!.managedIdleSec).toBeLessThanOrEqual(
      rows[0]!.idleSec + 1,
    );
  });

  it("overlays HOS duty onto idle events (rest/work), with uncovered time and no-driver idle → other", () => {
    const segs = new Map<string, HosSegment[]>([
      [
        "d1",
        [
          { driverId: "d1", status: "sleeper", startMs: T0, endMs: T0 + 2 * H },
          { driverId: "d1", status: "on_duty", startMs: T0 + 2 * H, endMs: T0 + 3 * H },
        ],
      ],
    ]);
    const rows = buildIdleRollupDays({
      engineDays: [],
      sessions: [],
      events: [
        // 1h fully inside sleeper → rest; 1h spanning sleeper→on_duty 30/30.
        { vehicleId: "v1", driverId: "d1", startMs: T0, durationSec: 3600 },
        { vehicleId: "v1", driverId: "d1", startMs: T0 + 1.5 * H, durationSec: 3600 },
        // 1h with no covering segment at all → other (uncovered).
        { vehicleId: "v1", driverId: "d1", startMs: T0 + 5 * H, durationSec: 3600 },
        // no driver → other.
        { vehicleId: "v1", driverId: null, startMs: T0 + 7 * H, durationSec: 600 },
      ],
      segmentsByDriver: segs,
      assignments: [],
      ...win,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      restIdleSec: 3600 + 1800,
      workIdleSec: 1800,
      otherIdleSec: 3600 + 600,
    });
  });

  it("preserves Optimized Idle envelope evidence with the continuous session", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        {
          vehicleId: "v1",
          day: D1,
          driveSec: 0,
          idleSec: 3600,
          offSec: 0,
          coverageSec: 3600,
        },
      ],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: T0 + H,
          idleSec: 3600,
          mode: "continuous",
          optimizedEnvelope: {
            status: "sufficient",
            source: "learned_behavioral",
            insideSec: 1800,
            outsideSec: 1200,
            unknownSec: 600,
            ambiguousSec: 0,
          },
        },
      ],
      events: [],
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    expect(rows[0]).toMatchObject({
      continuousIdleSec: 3600,
      optimizedEnvelopeInsideSec: 1800,
      optimizedEnvelopeOutsideSec: 1200,
      optimizedEnvelopeUnknownSec: 600,
      optimizedEnvelopeStatus: "sufficient",
      optimizedEnvelopeSource: "learned_behavioral",
    });
  });

  it("preserves direct HOS evidence and the operational grace in the rollup", () => {
    const rows = buildIdleRollupDays({
      engineDays: [],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: T0 + H,
          idleSec: 3600,
          mode: "continuous",
          dutyEvidence: {
            status: "sufficient",
            restSec: 1800,
            workSec: 1800,
            unknownSec: 0,
            ambiguousSec: 0,
            graceSec: 900,
          },
        },
      ],
      events: [],
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    expect(rows[0]).toMatchObject({
      hosRestSec: 1800,
      hosWorkSec: 1800,
      hosGraceSec: 900,
      hosEvidenceStatus: "sufficient",
    });
  });

  it("attributes the day to the dominant driver by idle-event duration", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 0, idleSec: 0, offSec: 0, coverageSec: 0 },
      ],
      sessions: [],
      events: [
        { vehicleId: "v1", driverId: "dA", startMs: T0 + H, durationSec: 600 },
        { vehicleId: "v1", driverId: "dB", startMs: T0 + 2 * H, durationSec: 6000 },
      ],
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    expect(rows[0]!.attributedDriverId).toBe("dB");
  });

  it("falls back to the vehicle's window-dominant driver for a day with no direct signal", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 100, idleSec: 0, offSec: 0, coverageSec: 100 },
        { vehicleId: "v1", day: D2, driveSec: 100, idleSec: 0, offSec: 0, coverageSec: 100 },
      ],
      sessions: [],
      events: [{ vehicleId: "v1", driverId: "dA", startMs: T0 + H, durationSec: 600 }], // only day 1
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    const d2 = rows.find((r) => r.day === D2)!;
    expect(d2.attributedDriverId).toBe("dA"); // vehicle-dominant fallback
  });

  it("folds assignment day-overlap into attribution and clamps open intervals to the window", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 100, idleSec: 50, offSec: 0, coverageSec: 150 },
      ],
      sessions: [],
      events: [{ vehicleId: "v1", driverId: "dA", startMs: T0 + H, durationSec: 60 }], // 60s for dA
      segmentsByDriver: new Map(),
      // Open-ended assignment for dB covering the whole day → far more weight than dA's one event.
      assignments: [{ vehicleId: "v1", driverId: "dB", startMs: T0, endMs: null }],
      windowStartMs: T0,
      windowEndMs: T0 + 86_400_000, // 1-day window — clamp point for the open interval
    });
    expect(rows[0]!.attributedDriverId).toBe("dB");
  });

  it("creates a row for a day that only has an idle event (no engine-day row)", () => {
    const rows = buildIdleRollupDays({
      engineDays: [],
      sessions: [],
      events: [{ vehicleId: "v9", driverId: null, startMs: T0 + H, durationSec: 120 }],
      segmentsByDriver: new Map(),
      assignments: [],
      ...win,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vehicleId: "v9", day: D1, otherIdleSec: 120, driveSec: 0 });
  });

  it("rounds every persisted seconds aggregate to an integer", () => {
    const fractional = 13_449.999;
    const rows = buildIdleRollupDays({
      engineDays: [
        {
          vehicleId: "v1",
          day: D1,
          driveSec: fractional,
          idleSec: fractional,
          offSec: fractional,
          coverageSec: fractional,
        },
      ],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: T0 + H,
          idleSec: fractional,
          mode: "continuous",
          optimizedEnvelope: {
            status: "sufficient",
            source: "documented_default",
            insideSec: fractional,
            outsideSec: fractional,
            unknownSec: fractional,
            ambiguousSec: fractional,
          },
          dutyEvidence: {
            status: "sufficient",
            restSec: fractional,
            workSec: fractional,
            unknownSec: fractional,
            ambiguousSec: fractional,
            graceSec: fractional,
          },
        },
      ],
      events: [{ vehicleId: "v1", driverId: "d1", startMs: T0, durationSec: fractional }],
      segmentsByDriver: new Map([
        [
          "d1",
          [
            { driverId: "d1", status: "sleeper", startMs: T0, endMs: T0 + 4_000_000 },
            { driverId: "d1", status: "on_duty", startMs: T0 + 4_000_000, endMs: T0 + 8_000_000 },
          ],
        ],
      ]),
      assignments: [],
      ...win,
    });

    const seconds = [
      "driveSec",
      "idleSec",
      "offSec",
      "coverageSec",
      "managedIdleSec",
      "continuousIdleSec",
      "restIdleSec",
      "workIdleSec",
      "otherIdleSec",
      "optimizedEnvelopeInsideSec",
      "optimizedEnvelopeOutsideSec",
      "optimizedEnvelopeUnknownSec",
      "optimizedEnvelopeAmbiguousSec",
      "hosRestSec",
      "hosWorkSec",
      "hosUnknownSec",
      "hosAmbiguousSec",
      "hosGraceSec",
    ] as const;
    for (const field of seconds) expect(Number.isInteger(rows[0]![field])).toBe(true);
  });
});
