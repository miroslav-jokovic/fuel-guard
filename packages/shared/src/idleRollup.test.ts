import { describe, it, expect } from "vitest";
import { buildIdleRollupDays } from "./idleRollup.js";

const T0 = Date.parse("2026-06-01T00:00:00.000Z"); // day boundary
const H = 3600_000;
const H_S = 3600;
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

  it("splits an overnight session across the days it spans instead of stranding it on the start day", () => {
    // 10h park from 20:00 D1 to 06:00 D2 with 9h of continuous idle. Engine days split at midnight, so D1
    // observes 4h of idle and D2 observes 6h. Bucketing the whole session on D1 pinned it to D1's 4h cap and
    // threw the other 5h away; the split keeps 4h on D1 (40% of the span) and 5.4h on D2.
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 0, idleSec: 4 * H_S, offSec: 0, coverageSec: 4 * H_S },
        { vehicleId: "v1", day: D2, driveSec: 0, idleSec: 6 * H_S, offSec: 0, coverageSec: 6 * H_S },
      ],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: T0 + 20 * H,
          endedAtMs: T0 + 30 * H,
          idleSec: 9 * H_S,
          mode: "continuous",
        },
      ],
      assignments: [],
      ...win,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: D1, continuousIdleSec: 3.6 * H_S });
    expect(rows[1]).toMatchObject({ day: D2, continuousIdleSec: 5.4 * H_S });
    // Nothing was clipped away: the whole 9h survives, where start-day bucketing kept only 4h.
    expect(rows[0]!.continuousIdleSec + rows[1]!.continuousIdleSec).toBe(9 * H_S);
  });

  it("prorates a split session's evidence buckets with its idle seconds", () => {
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 0, idleSec: 8 * H_S, offSec: 0, coverageSec: 8 * H_S },
        { vehicleId: "v1", day: D2, driveSec: 0, idleSec: 8 * H_S, offSec: 0, coverageSec: 8 * H_S },
      ],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: T0 + 22 * H,
          endedAtMs: T0 + 26 * H, // 2h on D1, 2h on D2 → 50/50
          idleSec: 4 * H_S,
          mode: "continuous",
          dutyEvidence: {
            status: "sufficient",
            restSec: 4 * H_S,
            workSec: 0,
            unknownSec: 0,
            ambiguousSec: 0,
            graceSec: 0,
          },
        },
      ],
      assignments: [],
      ...win,
    });
    expect(rows[0]).toMatchObject({ day: D1, continuousIdleSec: 2 * H_S, hosRestSec: 2 * H_S });
    expect(rows[1]).toMatchObject({ day: D2, continuousIdleSec: 2 * H_S, hosRestSec: 2 * H_S });
  });

  it("cuts days on the org timezone so sessions land on the same day as their engine time", () => {
    // 02:00 UTC on 2026-06-02 is still 2026-06-01 in America/Chicago (UTC-5), which is the clock
    // aggregateEngineDays bucketed the engine day on.
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 0, idleSec: 4 * H_S, offSec: 0, coverageSec: 4 * H_S },
      ],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: Date.parse("2026-06-02T02:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-02T03:00:00.000Z"),
          idleSec: 3600,
          mode: "continuous",
        },
      ],
      assignments: [],
      tz: "America/Chicago",
      ...win,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: D1, continuousIdleSec: 3600 });
  });

  it("builds the rest/on-duty/other split from the parks' own duty overlay, not from idle events", () => {
    // The row used to carry TWO different HOS splits: these display columns from an idle-event overlay,
    // and the hos_* verdict columns from the park sessions. They disagreed by construction. Both now come
    // from the same place — and the verdict columns still count CONTINUOUS parks only, while the display
    // columns cover every park.
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 0, idleSec: 5 * H_S, offSec: 0, coverageSec: 5 * H_S },
      ],
      sessions: [
        {
          vehicleId: "v1",
          startedAtMs: T0 + H,
          endedAtMs: T0 + 4 * H,
          idleSec: 3 * H_S,
          mode: "continuous",
          dutyEvidence: {
            status: "sufficient",
            restSec: 2 * H_S,
            workSec: 0.5 * H_S,
            unknownSec: 0.5 * H_S,
            ambiguousSec: 0,
            graceSec: 0,
          },
        },
        {
          vehicleId: "v1",
          startedAtMs: T0 + 5 * H,
          endedAtMs: T0 + 6 * H,
          idleSec: 1 * H_S,
          mode: "apu_or_off",
          dutyEvidence: {
            status: "sufficient",
            restSec: 1 * H_S,
            workSec: 0,
            unknownSec: 0,
            ambiguousSec: 0,
            graceSec: 0,
          },
        },
      ],
      assignments: [],
      ...win,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      // Display: BOTH parks — 2h rest continuous + 1h rest managed.
      restIdleSec: 3 * H_S,
      workIdleSec: 0.5 * H_S,
      // 0.5h unevidenced + the 1h of idle no park covered (under the 30-min floor): never guessed as rest.
      otherIdleSec: 1.5 * H_S,
      // Verdict: the continuous park only.
      hosRestSec: 2 * H_S,
      hosWorkSec: 0.5 * H_S,
    });
    expect(rows[0]!.restIdleSec + rows[0]!.workIdleSec + rows[0]!.otherIdleSec).toBe(5 * H_S);
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

  it("attributes the day to the driver assigned for most of it", () => {
    // Attribution is the driver<->vehicle assignment, not the operator Samsara stamped on an idle event:
    // assignments cover 98.7% of truck-days against the events' 84.3%, and dropping the event signal cost
    // nothing measurable (audit 2026-08-13).
    const rows = buildIdleRollupDays({
      engineDays: [
        { vehicleId: "v1", day: D1, driveSec: 0, idleSec: 0, offSec: 0, coverageSec: 0 },
      ],
      sessions: [],
      assignments: [
        { vehicleId: "v1", driverId: "dA", startMs: T0, endMs: T0 + 4 * H },
        { vehicleId: "v1", driverId: "dB", startMs: T0 + 4 * H, endMs: T0 + 20 * H },
      ],
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
      // dA is assigned on day 1 only; day 2 has engine time but no assignment of its own.
      assignments: [{ vehicleId: "v1", driverId: "dA", startMs: T0, endMs: T0 + 12 * H }],
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
      sessions: [], // 60s for dA
      // Open-ended assignment for dB covering the whole day → far more weight than dA's one event.
      assignments: [{ vehicleId: "v1", driverId: "dB", startMs: T0, endMs: null }],
      windowStartMs: T0,
      windowEndMs: T0 + 86_400_000, // 1-day window — clamp point for the open interval
    });
    expect(rows[0]!.attributedDriverId).toBe("dB");
  });

  it("creates no row for a truck-day with no engine time and no park session", () => {
    // Rows used to be conjured by an idle event alone. Engine days and park sessions are the only
    // observations now, so an assignment by itself describes no measured idle and earns no row.
    const rows = buildIdleRollupDays({
      engineDays: [],
      sessions: [],
      assignments: [{ vehicleId: "v9", driverId: "dA", startMs: T0, endMs: T0 + 12 * H }],
      ...win,
    });
    expect(rows).toEqual([]);
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
