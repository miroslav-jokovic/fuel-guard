import { describe, it, expect } from "vitest";
import { buildIdleSessions, learnIdleCapability, parseEngineStates, type EngineSample, type IdleSession } from "./idleSessions.js";

describe("parseEngineStates", () => {
  it("parses engineStates with the decorated gps speed", () => {
    const m = parseEngineStates({
      data: [
        {
          id: 99,
          engineStates: [
            { time: "2026-07-08T00:00:00Z", value: "Idle", decorations: { gps: { speedMilesPerHour: 0 } } },
            { time: "2026-07-08T00:10:00Z", value: "On", decorations: { gps: { speedMilesPerHour: 62 } } },
            { time: "2026-07-08T00:20:00Z", value: "Bogus" }, // ignored
          ],
        },
      ],
    });
    const s = m.get("99")!;
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ state: "Idle", speedMph: 0 });
    expect(s[1]).toMatchObject({ state: "On", speedMph: 62 });
  });
});

const MIN = 60_000;
// helper: state change at minute `m` with a speed
const s = (m: number, state: EngineSample["state"], speedMph = 0): EngineSample => ({ t: m * MIN, state, speedMph });

describe("buildIdleSessions", () => {
  it("classifies a long continuous idle as 'continuous'", () => {
    // Idle from min 0 to min 120 (2 h), then drive.
    const out = buildIdleSessions([s(0, "Idle"), s(120, "On", 60), s(130, "On", 60)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe("continuous");
    expect(out[0]!.idleSec).toBe(120 * 60);
    expect(out[0]!.offSec).toBe(0);
  });

  it("classifies engine-off-dominant parks as 'apu_or_off'", () => {
    // 10 min idle then 110 min OFF (APU carrying the load).
    const out = buildIdleSessions([s(0, "Idle"), s(10, "Off"), s(120, "On", 60), s(130, "On", 60)]);
    expect(out[0]!.mode).toBe("apu_or_off");
  });

  it("classifies On↔Off cycling as 'optimized_cycling'", () => {
    // Alternate Idle/Off every 15 min for 2 h → several cycles, meaningful off time, not off-dominant.
    const samples: EngineSample[] = [];
    for (let m = 0; m < 120; m += 15) samples.push(s(m, (m / 15) % 2 === 0 ? "Idle" : "Off"));
    samples.push(s(120, "On", 60), s(130, "On", 60));
    const out = buildIdleSessions(samples);
    expect(out[0]!.mode).toBe("optimized_cycling");
    expect(out[0]!.cycles).toBeGreaterThanOrEqual(4);
  });

  it("ignores short stops (below the min session length)", () => {
    expect(buildIdleSessions([s(0, "Idle"), s(10, "On", 60), s(20, "On", 60)])).toHaveLength(0);
  });

  it("splits sessions on driving between parks", () => {
    const out = buildIdleSessions([
      s(0, "Idle"), s(60, "On", 60), // park 1 (1h), then drive
      s(120, "Idle"), s(240, "On", 60), // drive gap, park 2 (2h)
      s(250, "On", 60),
    ]);
    expect(out.length).toBe(2);
  });
});

describe("learnIdleCapability", () => {
  const sess = (mode: IdleSession["mode"], hours = 8): IdleSession => ({
    startMs: 0, endMs: hours * 3600_000, durationSec: hours * 3600,
    idleSec: mode === "apu_or_off" ? hours * 360 : hours * 3600,
    offSec: mode === "apu_or_off" ? hours * 3240 : mode === "optimized_cycling" ? hours * 1800 : 0,
    cycles: mode === "optimized_cycling" ? 10 : 0, mode,
  });

  it("is 'unknown' without enough sessions", () => {
    expect(learnIdleCapability([sess("apu_or_off")]).capability).toBe("unknown");
  });
  it("detects an APU truck (routinely engine-off through long parks)", () => {
    expect(learnIdleCapability([sess("apu_or_off"), sess("apu_or_off"), sess("apu_or_off"), sess("continuous")]).capability).toBe("apu");
  });
  it("detects an ECU-optimized truck (cycling)", () => {
    expect(learnIdleCapability([sess("optimized_cycling"), sess("optimized_cycling"), sess("optimized_cycling"), sess("continuous")]).capability).toBe("ecu_optimized");
  });
  it("flags a truck that only ever idles continuously", () => {
    const r = learnIdleCapability([sess("continuous"), sess("continuous"), sess("continuous"), sess("continuous")]);
    expect(r.capability).toBe("continuous_only");
    expect(r.optimizedPct).toBe(0);
  });
});
