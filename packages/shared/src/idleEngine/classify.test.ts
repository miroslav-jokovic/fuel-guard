import { describe, expect, it } from "vitest";
import {
  classifyIdleEngine,
  counterAt,
  engineSegments,
  IDLE_ENGINE_VERSION,
  parseCounter,
  parseEngineFlips,
  parseMotionFixes,
  roundParts,
  stateOfPlace,
  type IdleEngineInput,
  type MotionFix,
} from "./index.js";

const T0 = Date.parse("2026-10-02T00:00:00Z");
const MIN = 60_000;
const at = (min: number) => T0 + min * MIN;

/** A fix every `stepSec` over [fromMin, toMin) at `mph`, parked at (lat, lng). */
function fixes(fromMin: number, toMin: number, mph: number, o: { stepSec?: number; lat?: number; lng?: number; place?: string } = {}): MotionFix[] {
  const out: MotionFix[] = [];
  for (let t = at(fromMin); t < at(toMin); t += (o.stepSec ?? 30) * 1000)
    out.push({ t, mph, lat: o.lat ?? 41.5, lng: o.lng ?? -88.1, place: o.place ?? "Joliet, Will County, IL" });
  return out;
}

function run(over: Partial<IdleEngineInput>) {
  return classifyIdleEngine({
    fromMs: at(0),
    toMs: at(60),
    dataEndMs: at(70),
    spanStartMs: at(-60),
    engine: [],
    engineSeed: true,
    gps: [],
    parked: null,
    fuelMl: [],
    engineSec: [],
    ambientMilliC: [],
    minIdleSec: 300,
    ...over,
  });
}

const sum = (h: { drivingSec: number; stoppedRunningSec: number; briefStopSec: number; engineOffSec: number; noDataSec: number }) =>
  h.drivingSec + h.stoppedRunningSec + h.briefStopSec + h.engineOffSec + h.noDataSec;

describe("classifyIdleEngine — the five buckets (D-IE2)", () => {
  it("a truck driving the whole hour is all driving and has no stop", () => {
    const { hours, stops } = run({ gps: fixes(-15, 70, 62) });
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ drivingSec: 3600, stoppedRunningSec: 0, briefStopSec: 0, engineOffSec: 0, noDataSec: 0 });
    expect(stops).toEqual([]);
  });

  it("a thirty-minute park with the engine running is stopped-running, and one stop row", () => {
    const gps = [...fixes(-15, 20, 60), ...fixes(20, 50, 0), ...fixes(50, 70, 55)];
    const { hours, stops } = run({ gps });
    expect(hours[0]).toMatchObject({ drivingSec: 1800, stoppedRunningSec: 1800, briefStopSec: 0 });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      startedAtMs: at(20),
      endedAtMs: at(50),
      startObserved: true,
      durationSec: 1800,
      runningSec: 1800,
      offSec: 0,
      longestRunSec: 1800,
      state: "IL",
    });
  });

  it("a forty-second red light is absorbed by the 60 s debounce — still driving, no stop", () => {
    const gps = [...fixes(-15, 30, 60), ...fixes(30, 30 + 40 / 60, 0, { stepSec: 10 }), ...fixes(30 + 40 / 60, 70, 60)];
    const { hours, stops } = run({ gps });
    expect(hours[0]).toMatchObject({ drivingSec: 3600, briefStopSec: 0, stoppedRunningSec: 0 });
    expect(stops).toEqual([]);
  });

  it("a three-minute stop with the engine running is brief_stop and gets no stop row (Q-IE9)", () => {
    const gps = [...fixes(-15, 30, 60), ...fixes(30, 33, 0), ...fixes(33, 70, 60)];
    const { hours, stops } = run({ gps });
    expect(hours[0]).toMatchObject({ drivingSec: 3420, briefStopSec: 180, stoppedRunningSec: 0 });
    expect(stops).toEqual([]);
  });

  it("speed exactly at the threshold is moving (3 mph is the line, D-IE1)", () => {
    const gps = [...fixes(-15, 20, 60), ...fixes(20, 50, 3), ...fixes(50, 70, 60)];
    expect(run({ gps }).hours[0]!.drivingSec).toBe(3600);
  });

  it("a battery-APU truck cycling three minutes on, twenty-seven off, is NOT brief: one stop, its starts and its longest run", () => {
    const gps = [...fixes(-15, 0, 60), ...fixes(0, 240, 0), ...fixes(240, 260, 60)];
    const engine = [];
    for (let m = 0; m < 240; m += 30) engine.push({ t: at(m), on: true }, { t: at(m + 3), on: false });
    engine.push({ t: at(240), on: true });
    const { hours, stops } = run({ toMs: at(240), dataEndMs: at(260), gps, engine });
    expect(hours).toHaveLength(4);
    for (const h of hours) expect(h).toMatchObject({ stoppedRunningSec: 360, engineOffSec: 3240, briefStopSec: 0 });
    expect(stops).toHaveLength(1);
    // The engine was already running when the park began, so that is not a start; the restart that
    // drives away at 240 min belongs to the next hour. Seven starts: 30, 60, … 210.
    expect(stops[0]).toMatchObject({ durationSec: 14400, runningSec: 1440, offSec: 12960, engineStarts: 7, longestRunSec: 180 });
    expect(hours.map((h) => h.engineStarts)).toEqual([1, 2, 2, 2]);
  });

  it("the longest run is the longest CONTINUOUS one, not the total", () => {
    const gps = [...fixes(-15, 0, 60), ...fixes(0, 60, 0), ...fixes(60, 70, 60)];
    const engine = [
      { t: at(0), on: true },
      { t: at(10), on: false },
      { t: at(20), on: true },
      { t: at(45), on: false },
      { t: at(50), on: true },
    ];
    const s = run({ gps, engine }).stops[0]!;
    expect(s).toMatchObject({ runningSec: 2700, offSec: 900, longestRunSec: 1500, engineStarts: 2 });
  });
});

describe("classifyIdleEngine — what is not known stays not known", () => {
  it("an unknown engine is no_data even with a perfect GPS stream, never off", () => {
    const { hours } = run({ engineSeed: null, gps: fixes(-15, 70, 0) });
    expect(hours[0]).toMatchObject({ noDataSec: 3600, engineOffSec: 0 });
  });

  it("the state before the first flip is the seed: unknown until the flip, known after", () => {
    const { hours } = run({ engineSeed: null, engine: [{ t: at(15), on: true }], gps: fixes(-15, 70, 60) });
    expect(hours[0]).toMatchObject({ noDataSec: 900, drivingSec: 2700 });
  });

  it("an engine that is off is a stopped truck even when the gateway goes quiet — a park, not a gap", () => {
    const { hours, stops } = run({ engineSeed: false, gps: fixes(-15, 5, 0) });
    expect(hours[0]).toMatchObject({ engineOffSec: 3600, noDataSec: 0 });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ endedAtMs: null, offSec: stops[0]!.durationSec });
  });

  it("a running engine with no GPS past the ten-minute horizon is no_data, not stopped", () => {
    const gps = [...fixes(-15, 20, 60), ...fixes(50, 70, 60)];
    const { hours } = run({ gps });
    // the last fix (19.5 min) holds ten minutes, then 20.5 minutes of nothing
    expect(hours[0]!.noDataSec).toBe(1230);
    expect(hours[0]!.drivingSec).toBe(3600 - 1230);
  });

  it("time after the data's end is no_data", () => {
    const { hours } = run({ dataEndMs: at(45), gps: fixes(-15, 45, 60) });
    expect(hours[0]).toMatchObject({ drivingSec: 2700, noDataSec: 900 });
  });

  it("every hour's buckets add up to exactly 3,600 s however the milliseconds fall", () => {
    const gps = [...fixes(-15, 7.3, 61, { stepSec: 7 }), ...fixes(7.3, 41.77, 0, { stepSec: 13 }), ...fixes(41.77, 70, 58, { stepSec: 11 })];
    const engine = [{ t: at(12.345), on: false }, { t: at(33.333), on: true }];
    const { hours } = run({ gps, engine });
    expect(sum(hours[0]!)).toBe(3600);
  });
});

describe("classifyIdleEngine — rounding and starts", () => {
  it("four buckets each ending on a half second still add up to 3,600 (plain rounding would give 3,602)", () => {
    const gps: MotionFix[] = [...fixes(-15, 9.5, 60), ...fixes(600.5 / 60, 70, 0)];
    const { hours } = run({ gps, engine: [{ t: at(30), on: false }], dataEndMs: at(60) - 500 });
    // driving 600.5, stopped-running 1,199.5, off 1,799.5, no data 0.5
    expect(sum(hours[0]!)).toBe(3600);
  });

  it("an unknown engine flipping to running is not a start: Samsara's Idle→On is running→running", () => {
    const { hours } = run({ engineSeed: null, engine: [{ t: at(15), on: true }, { t: at(30), on: false }, { t: at(40), on: true }], gps: fixes(-15, 70, 0) });
    expect(hours[0]!.engineStarts).toBe(1);
  });
});

describe("classifyIdleEngine — parks across gaps and windows (Q-IE10)", () => {
  const engineOn = { engineSeed: true };
  it("a park either side of a GPS gap, where the truck did not move, is ONE stop with the gap as no_data", () => {
    const gps = [...fixes(-15, 0, 60), ...fixes(0, 10, 0), ...fixes(40, 60, 0), ...fixes(60, 70, 60)];
    const { stops } = run({ ...engineOn, gps });
    expect(stops).toHaveLength(1);
    // the last fix before the gap (9.5 min) holds ten minutes, then 20.5 minutes of nothing
    expect(stops[0]).toMatchObject({ startedAtMs: at(0), endedAtMs: at(60), noDataSec: 1230, runningSec: 3600 - 1230 });
  });

  it("…but where it reappears five kilometres away it is two stops", () => {
    const gps = [...fixes(-15, 0, 60), ...fixes(0, 10, 0), ...fixes(40, 60, 0, { lat: 41.545 }), ...fixes(60, 70, 60)];
    expect(run({ ...engineOn, gps }).stops).toHaveLength(2);
  });

  it("a stored park continues from its row: start and its observed-ness carried, earlier GPS ignored", () => {
    const parked = { sinceMs: at(-600), startObserved: true };
    // A stray 'moving' fix before the window must not end a park the stored row says was continuous.
    const gps = [{ t: at(-5), mph: 40, lat: 41.5, lng: -88.1 }, ...fixes(0, 30, 0), ...fixes(30, 70, 50)];
    const engine = [{ t: at(-600), on: false }, { t: at(25), on: true }];
    const { stops } = run({ spanStartMs: at(-660), parked, gps, engine, engineSeed: true });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ startedAtMs: at(-600), endedAtMs: at(30), startObserved: true, offSec: 625 * 60, runningSec: 300 });
  });

  it("with no stored row, a park already under way when the GPS begins is marked unobserved", () => {
    const { stops } = run({ gps: [...fixes(-15, 30, 0), ...fixes(30, 70, 50)] });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ startedAtMs: at(-15), startObserved: false });
  });

  it("a park that closed before the window is not this run's to write; one closing inside it is", () => {
    const gps = [...fixes(-60, -40, 50), ...fixes(-40, -20, 0), ...fixes(-20, -5, 50), ...fixes(-5, 10, 0), ...fixes(10, 70, 50)];
    const { stops } = run({ gps });
    expect(stops.map((s) => [s.startedAtMs, s.endedAtMs])).toEqual([[at(-5), at(10)]]);
  });

  it("a park still parked at the data's end is open", () => {
    const { stops } = run({ gps: [...fixes(-15, 20, 60), ...fixes(20, 70, 0)] });
    expect(stops[0]).toMatchObject({ startedAtMs: at(20), endedAtMs: null, durationSec: 50 * 60 });
  });
});

describe("counters (IE2a) — interpolated along running time", () => {
  it("a night with the engine off books the burn to the minutes it ran, not across the clock", () => {
    // reading 1,000 mL at 22:00, engine off 22:10 → 06:00, 2,000 mL at 06:05: 10 + 5 running minutes.
    const night = Date.parse("2026-10-01T22:00:00Z");
    const engine = engineSegments(
      [{ t: night + 10 * MIN, on: false }, { t: night + 480 * MIN, on: true }],
      true,
      night - 60 * MIN,
      night + 600 * MIN,
    );
    const r = [{ t: night, value: 1000 }, { t: night + 485 * MIN, value: 2000 }];
    expect(counterAt(r, engine, night + 10 * MIN)).toBeCloseTo(1000 + 1000 * (10 / 15));
    expect(counterAt(r, engine, night + 300 * MIN)).toBeCloseTo(1000 + 1000 * (10 / 15)); // nothing burned while off
    expect(counterAt(r, engine, night + 482 * MIN)).toBeCloseTo(1000 + 1000 * (12 / 15));
  });

  it("an hour's fuel is the delta; unbracketed while running is null, never 0", () => {
    const gps = fixes(-15, 70, 60);
    const fuelMl = [{ t: at(-5), value: 100_000 }, { t: at(30), value: 120_000 }];
    const { hours } = run({ gps, fuelMl });
    expect(hours[0]!.fuelMl).toBeNull();
    const { hours: h2 } = run({ gps, fuelMl: [...fuelMl, { t: at(65), value: 140_000 }] });
    // 100,000 + 20,000·5/35 at 00:00; 120,000 + 20,000·30/35 at 01:00
    expect(h2[0]!.fuelMl).toBe(Math.round(120_000 + (20_000 * 30) / 35 - (100_000 + (20_000 * 5) / 35)));
  });

  it("an engine off since the last reading reads that reading — an idle-free park costs 0, not null", () => {
    const { hours, stops } = run({ engineSeed: false, gps: fixes(-15, 70, 0), fuelMl: [{ t: at(-30), value: 5_000 }] });
    expect(hours[0]!.fuelMl).toBe(0);
    expect(stops[0]!.fuelMl).toBe(0);
  });

  it("a counter that goes backwards (a swapped gateway) is null, not negative fuel", () => {
    const { hours } = run({ gps: fixes(-15, 70, 60), fuelMl: [{ t: at(-5), value: 9_000 }, { t: at(65), value: 1_000 }] });
    expect(hours[0]!.fuelMl).toBeNull();
  });

  it("an open stop's fuel runs to its last reading", () => {
    const gps = [...fixes(-15, 20, 60), ...fixes(20, 70, 0)];
    const fuelMl = [{ t: at(18), value: 1_000 }, { t: at(66), value: 1_900 }];
    const s = run({ gps, fuelMl }).stops[0]!;
    // 1,000 + 900·2/48 at the stop's start (20 min); 1,900 at its last reading
    expect(s.fuelMl).toBe(Math.round(1_900 - (1_000 + (900 * 2) / 48)));
  });

  it("ambient is the mean of the readings inside the hour", () => {
    const amb = [{ t: at(-1), value: 0 }, { t: at(10), value: 20_000 }, { t: at(40), value: 30_000 }];
    expect(run({ gps: fixes(-15, 70, 60), ambientMilliC: amb }).hours[0]!.ambientMilliC).toBe(25_000);
  });
});

describe("helpers", () => {
  it("roundParts keeps the total exact", () => {
    expect(roundParts([1500.4, 1099.3, 1000.3], 4)).toEqual([2, 1, 1]);
    expect(roundParts([3_599_999, 1], 3600)).toEqual([3600, 0]);
  });
  it("stateOfPlace reads the trailing two-letter state", () => {
    expect(stateOfPlace("Florida's Turnpike, Indian River County, FL")).toBe("FL");
    expect(stateOfPlace("Somewhere")).toBeNull();
    expect(stateOfPlace(null)).toBeNull();
  });
  it("the version is stamped for the rows", () => {
    expect(IDLE_ENGINE_VERSION).toMatch(/^ie2-/);
  });
});

describe("parse — Samsara stats/history pages", () => {
  const page = [
    {
      id: 281474,
      engineStates: [
        { time: "2026-10-02T01:00:00Z", value: "Idle" },
        { time: "2026-10-02T02:00:00Z", value: "Off" },
        { time: "2026-10-02T03:00:00Z", value: "Bogus" },
        { value: "On" },
      ],
      gps: [
        { time: "2026-10-02T01:00:00Z", speedMilesPerHour: 0, latitude: 41.5, longitude: -88.1, reverseGeo: { formattedLocation: "Joliet, IL" } },
        { time: "2026-10-02T01:00:30Z", latitude: 41.5, longitude: -88.1 },
      ],
      fuelConsumedMilliliters: [{ time: "2026-10-02T01:00:00Z", value: 563016787 }, { time: "x", value: 1 }],
    },
  ];
  it("Idle and On are running, Off is off, anything else is dropped", () => {
    expect(parseEngineFlips(page).get("281474")).toEqual([
      { t: Date.parse("2026-10-02T01:00:00Z"), on: true },
      { t: Date.parse("2026-10-02T02:00:00Z"), on: false },
    ]);
  });
  it("a fix with no speed is dropped — speed is the motion signal", () => {
    const f = parseMotionFixes(page).get("281474")!;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ mph: 0, lat: 41.5, place: "Joliet, IL" });
  });
  it("a counter reading with no parseable time is dropped", () => {
    expect(parseCounter(page, "fuelConsumedMilliliters").get("281474")).toEqual([{ t: Date.parse("2026-10-02T01:00:00Z"), value: 563016787 }]);
  });
});
