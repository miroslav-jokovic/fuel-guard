import { describe, expect, it } from "vitest";
import {
  IDLE_PARITY,
  idleEngineParityView,
  idleParityDays,
  idleParityFinalThrough,
  idleParityStage,
  idleParityReport,
  judgeIdleParityDay,
  type IdleParityDay,
} from "./parity.js";

/**
 * D-IE9's gate (IE5). The fixture day agrees on both checks with room to spare (running 10 h vs the
 * ECU's 10 h 6 min = −1%, stopped 4 h vs Samsara's 4 h 6 min ≈ −2.4%), and each test moves ONE input
 * to the edge it is about, so a check reading the wrong side, the wrong tolerance or the wrong bar
 * lands on a different verdict.
 */
const H = 3600;
const day = (o: Partial<IdleParityDay> = {}): IdleParityDay => ({
  vehicleId: "v1", day: "2026-10-03", hours: 24,
  runningSec: 10 * H, stoppedSec: 4 * H, ecuSec: 10 * H + 360, ecuHours: 24, samsaraIdleSec: 4 * H + 360,
  ...o,
});
const FINAL = "2026-10-03";

describe("judgeIdleParityDay", () => {
  it("passes a day both checks agree on", () => {
    const j = judgeIdleParityDay(day(), FINAL)!;
    expect(j.pass).toBe(true);
    expect(j.running!.diff).toBeCloseTo(-0.0099, 4);
    expect(j.stopped!.diff).toBeCloseTo(-0.0244, 4);
  });

  it("running: inside ±3% of the ECU passes, past it fails — in both directions", () => {
    expect(judgeIdleParityDay(day({ runningSec: 10_000, ecuSec: 10_300 }), FINAL)!.running!.pass).toBe(true); // −2.9%
    expect(judgeIdleParityDay(day({ runningSec: 10_000, ecuSec: 10_320 }), FINAL)!.running!.pass).toBe(false); // −3.1%
    expect(judgeIdleParityDay(day({ runningSec: 10_300, ecuSec: 10_000 }), FINAL)!.running!.pass).toBe(true); // +3.0%
    expect(judgeIdleParityDay(day({ runningSec: 10_310, ecuSec: 10_000 }), FINAL)!.running!.pass).toBe(false); // +3.1%
  });

  it("stopped running is measured against ±5% of Samsara's idle, not ±3%", () => {
    expect(judgeIdleParityDay(day({ stoppedSec: 10_450, samsaraIdleSec: 10_000 }), FINAL)!.stopped!.pass).toBe(true); // +4.5%
    expect(judgeIdleParityDay(day({ stoppedSec: 10_510, samsaraIdleSec: 10_000 }), FINAL)!.stopped!.pass).toBe(false); // +5.1%
  });

  it("a running miss fails the day; a stopped-running miss does not (Q-IE17)", () => {
    expect(judgeIdleParityDay(day({ runningSec: 11 * H }), FINAL)!.pass).toBe(false);
    const j = judgeIdleParityDay(day({ stoppedSec: 6 * H }), FINAL)!;
    expect(j.stopped!.pass).toBe(false);
    expect(j.pass).toBe(true);
  });

  it("is not judged before it is final, or when our hours are not whole", () => {
    expect(judgeIdleParityDay(day({ day: "2026-10-04" }), FINAL)).toBeNull();
    expect(judgeIdleParityDay(day(), null)).toBeNull();
    expect(judgeIdleParityDay(day({ hours: 23 }), FINAL)).toBeNull();
  });

  it("a day the ECU missed an hour of is not judged at all, whatever Samsara says", () => {
    expect(judgeIdleParityDay(day({ ecuHours: 23, ecuSec: 1 }), FINAL)).toBeNull();
    expect(judgeIdleParityDay(day({ ecuHours: 23, ecuSec: 1, stoppedSec: 0 }), FINAL)).toBeNull();
  });

  it("under an hour on BOTH sides is not judged; an hour on EITHER side is, and a zero on the other fails", () => {
    expect(judgeIdleParityDay(day({ runningSec: 3599, ecuSec: 3500, stoppedSec: 0, samsaraIdleSec: 3599 }), FINAL)).toBeNull();
    const j = judgeIdleParityDay(day({ stoppedSec: H, samsaraIdleSec: 0 }), FINAL)!;
    expect(j.stopped).toMatchObject({ diff: null, pass: false });
    expect(j.pass).toBe(true);
    expect(judgeIdleParityDay(day({ samsaraIdleSec: null }), FINAL)!.stopped).toBeNull();
    // The ECU says 2 h, we say 17 minutes: judged on the ECU's hour, and failed.
    const r = judgeIdleParityDay(day({ runningSec: 1000, ecuSec: 2 * H, stoppedSec: 0, samsaraIdleSec: 0 }), FINAL)!;
    expect(r).toMatchObject({ stopped: null, pass: false, running: { pass: false } });
  });
});

describe("idleParityReport", () => {
  const days = (n: number, vehicleId = "v1", o: Partial<IdleParityDay> = {}) =>
    Array.from({ length: n }, (_, i) => day({ vehicleId, day: `2026-10-${String(i + 1).padStart(2, "0")}`, ...o }));
  const FINAL_14 = "2026-10-14";

  it("passes at 14 judged days with 95% of truck-days agreeing", () => {
    // 19 trucks agree on every day; one fails exactly one day → 279 / 280 = 99.6%.
    const rows = [...Array.from({ length: 19 }, (_, i) => days(14, `v${i}`)).flat(), ...days(13, "vx"), day({ vehicleId: "vx", day: "2026-10-14", runningSec: 0, stoppedSec: 0 })];
    const r = idleParityReport(rows, FINAL_14);
    expect(r).toMatchObject({ daysNeeded: 0, pass: true, truckDays: { judged: 280, passed: 279 } });
    expect(r.disagreements).toEqual([{ vehicleId: "vx", judgedDays: 14, failedDays: 1, worstRunningDiff: -1, worstStoppedDiff: -1 }]);
  });

  it("does not pass at 13 days however well they agree, and says how many are still needed", () => {
    const r = idleParityReport(days(13), FINAL_14);
    expect(r).toMatchObject({ share: 1, daysNeeded: 1, pass: false });
  });

  it("does not pass below 95%: 18 of 19 agreeing is 94.7%", () => {
    const rows = [...Array.from({ length: 18 }, (_, i) => days(14, `v${i}`)).flat(), ...days(14, "vx", { runningSec: 5 * H })];
    const r = idleParityReport(rows, FINAL_14);
    expect(r.share).toBeCloseTo(18 / 19, 6);
    expect(r.pass).toBe(false);
  });

  it("counts each check apart, and a day after the final one or without a whole ECU day is in no count", () => {
    const rows = [
      ...days(2),
      day({ day: "2026-10-03", vehicleId: "v3", stoppedSec: 6 * H }),
      day({ day: "2026-10-03", vehicleId: "v4", samsaraIdleSec: null }),
      day({ day: "2026-10-15" }),
      day({ day: "2026-10-01", vehicleId: "v2", ecuHours: 10 }),
    ];
    const r = idleParityReport(rows, FINAL_14);
    expect(r.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(r.truckDays).toEqual({ judged: 4, passed: 4, runningJudged: 4, runningPassed: 4, stoppedJudged: 3, stoppedPassed: 2 });
    expect(r.disagreements).toEqual([]);
  });

  it("orders disagreements by failed days and keeps the worst miss signed", () => {
    const rows = [
      day({ vehicleId: "a", day: "2026-10-01", runningSec: 11 * H }),
      day({ vehicleId: "b", day: "2026-10-01", runningSec: 9 * H }),
      day({ vehicleId: "b", day: "2026-10-02", runningSec: 8 * H }),
    ];
    const r = idleParityReport(rows, FINAL_14);
    expect(r.disagreements.map((d) => [d.vehicleId, d.failedDays])).toEqual([["b", 2], ["a", 1]]);
    expect(r.disagreements[0]!.worstRunningDiff).toBeCloseTo(8 * H / (10 * H + 360) - 1, 6);
  });

  it("nothing judged: no share, and nothing passes", () => {
    expect(idleParityReport([], FINAL_14)).toMatchObject({ share: null, pass: false, daysNeeded: IDLE_PARITY.minDays });
  });
});

describe("idleParityFinalThrough", () => {
  it("is the local day the latest nightly's window began on", () => {
    // 2026-10-01T05:00Z is midnight 10/01 in Chicago; the nightly that ran early 10/03 started there.
    expect(idleParityFinalThrough("2026-10-01T05:00:00.000Z", "America/Chicago")).toBe("2026-10-01");
    expect(idleParityFinalThrough("2026-10-01T04:59:59.000Z", "America/Chicago")).toBe("2026-09-30");
    expect(idleParityFinalThrough(null, "America/Chicago")).toBeNull();
  });
});

describe("idleParityDays (the stored rows → truck-days, read by the office API and the console alike)", () => {
  const stored = (o: Record<string, unknown> = {}) => ({
    vehicle_id: "v1",
    day: "2026-10-01",
    hours: 24,
    driving_sec: 6 * H,
    stopped_running_sec: 3 * H,
    brief_stop_sec: H,
    engine_sec: String(10 * H + 360),
    engine_sec_hours: 24,
    ...o,
  });
  const samsara = (o: Record<string, unknown> = {}) => ({ vehicle_id: "v1", day: "2026-10-01", idle_sec: "14760", coverage_sec: 24 * H, ...o });

  it("running is all three buckets, stopped is stopped running plus brief stops, bigints read as numbers", () => {
    const [d] = idleParityDays([stored()], [samsara()]);
    expect(d).toEqual({
      vehicleId: "v1", day: "2026-10-01", hours: 24,
      runningSec: 10 * H, stoppedSec: 4 * H, ecuSec: 10 * H + 360, ecuHours: 24, samsaraIdleSec: 14760,
    });
  });

  it("Samsara's idle counts only when its coverage is the whole local day — a DST day's 25 hours included", () => {
    expect(idleParityDays([stored()], [samsara({ coverage_sec: 24 * H - 1 })])[0]!.samsaraIdleSec).toBeNull();
    expect(idleParityDays([stored({ hours: 25 })], [samsara({ coverage_sec: 24 * H })])[0]!.samsaraIdleSec).toBeNull();
    expect(idleParityDays([stored({ hours: 25 })], [samsara({ coverage_sec: 25 * H })])[0]!.samsaraIdleSec).toBe(14760);
    expect(idleParityDays([stored()], [samsara({ coverage_sec: null })])[0]!.samsaraIdleSec).toBeNull();
  });

  it("pairs by truck AND day: another truck's or another day's row is not this one's", () => {
    const theirs = [samsara({ vehicle_id: "v2" }), samsara({ day: "2026-09-30" })];
    expect(idleParityDays([stored()], theirs)[0]!.samsaraIdleSec).toBeNull();
  });
});

describe("idleEngineParityView", () => {
  it("attaches each disagreeing truck's unit, a dash for a truck the vehicle read did not return", () => {
    const report = idleParityReport(
      [day({ vehicleId: "v1", ecuSec: 20 * H }), day({ vehicleId: "v2", ecuSec: 20 * H })],
      FINAL,
    );
    const view = idleEngineParityView(report, "America/Chicago", new Map([["v1", "650"]]));
    expect(view.timezone).toBe("America/Chicago");
    expect(view.disagreements.map((d) => [d.vehicleId, d.unit])).toEqual([["v1", "650"], ["v2", "—"]]);
  });
});

describe("idleParityStage", () => {
  it("checking until the days are in, then pass or disagreeing on the share", () => {
    expect(idleParityStage({ pass: false, daysNeeded: 1 })).toBe("checking");
    expect(idleParityStage({ pass: false, daysNeeded: 0 })).toBe("disagreeing");
    expect(idleParityStage({ pass: true, daysNeeded: 0 })).toBe("pass");
  });
});
