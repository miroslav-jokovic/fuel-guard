import { describe, expect, it } from "vitest";
import { allowedSeek, clock, megabytes, mergeQueued, pickHeight, type QueuedSpan } from "./signal";

/** The driver page's weak-signal rules (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8.2, D-TR4). */
describe("which rendition a phone plays", () => {
  const all = [720, 360, 540];
  it("plays the smallest when the driver asks for low data, Data Saver is on, or the network is 3G or worse", () => {
    expect(pickHeight(all, "low", { effectiveType: "4g", downlink: 20 })).toBe(360);
    expect(pickHeight(all, "normal", { saveData: true })).toBe(360);
    for (const t of ["slow-2g", "2g", "3g"]) expect(pickHeight(all, "normal", { effectiveType: t })).toBe(360);
  });
  it("plays the sharpest only on a fast 4G", () => {
    expect(pickHeight(all, "normal", { effectiveType: "4g", downlink: 5 })).toBe(720);
    expect(pickHeight(all, "normal", { effectiveType: "4g", downlink: 4.9 })).toBe(540);
  });
  it("plays the middle one when the browser says nothing about its connection (Safari)", () => {
    expect(pickHeight(all, "normal", null)).toBe(540);
  });
  it("makes do with what a film has", () => {
    expect(pickHeight([360], "normal", null)).toBe(360);
    expect(pickHeight([360, 720], "normal", null)).toBe(720);
    expect(pickHeight([], "normal", null)).toBeNull();
  });
});

describe("spans played with no signal", () => {
  const span = (fromMs: number, toMs: number, versionId = "v1"): QueuedSpan => ({ versionId, fromMs, toMs, positionMs: toMs });
  it("go up as one report when they follow on from each other", () => {
    expect(mergeQueued([span(0, 10_000), span(10_000, 20_000), span(21_500, 30_000)])).toEqual([span(0, 30_000)]);
  });
  it("stay apart across a jump, a step back, or another film", () => {
    expect(mergeQueued([span(0, 10_000), span(15_000, 20_000)])).toHaveLength(2);
    expect(mergeQueued([span(10_000, 20_000), span(0, 5_000)])).toHaveLength(2);
    expect(mergeQueued([span(0, 10_000), span(10_000, 20_000, "v2")])).toHaveLength(2);
  });
  it("leave the queue they were given untouched", () => {
    const q = [span(0, 10_000), span(10_000, 20_000)];
    mergeQueued(q);
    expect(q[0]).toEqual(span(0, 10_000));
  });
});

describe("seeking on a first watch", () => {
  it("goes back anywhere, and forward only into what was watched", () => {
    expect(allowedSeek(5_000, [], 60_000, [])).toBe(true);
    expect(allowedSeek(61_000, [], 60_000, [])).toBe(true); // a tap a little ahead
    expect(allowedSeek(90_000, [], 60_000, [])).toBe(false);
    expect(allowedSeek(90_000, [[80_000, 100_000]], 60_000, [])).toBe(true);
  });
  it("may jump straight to a chapter a failed quiz reopened", () => {
    expect(allowedSeek(120_000, [], 0, [120_000])).toBe(true);
    expect(allowedSeek(125_000, [], 0, [120_000])).toBe(false);
  });
});

describe("what the page prints", () => {
  it("writes times and sizes the way a driver reads them", () => {
    expect(clock(204_000)).toBe("3:24");
    expect(clock(-5)).toBe("0:00");
    expect(megabytes(2_202_010)).toBe("2.1 MB");
  });
});
