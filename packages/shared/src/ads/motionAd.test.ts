import { describe, expect, it } from "vitest";
import { FEED_FORMATS } from "./renderGeometry.js";
import {
  CAPTION_CHARS_PER_SECOND, MOTION_CLIP_MS, MOTION_FORMAT, MOTION_FPS, MOTION_HOLD_MS, MOTION_MAX_MS, MOTION_MIN_CUE_MS,
  motionTimeline, readMs,
} from "./motionAd.js";

const timelineOf = (...chars: number[]) => {
  const r = motionTimeline(chars.map((c, i) => ({ labels: [`row${i}`], chars: c })));
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.findings)}`);
  return r.timeline;
};

describe("motionTimeline", () => {
  it("the first words are on the first frame, and each later group waits for the one before it to be read", () => {
    const t = timelineOf(40, 60, 30);
    expect(t.cues.map((c) => c.from_ms)).toEqual([0, 2000, 5000]);
    expect(t.cues.map((c) => c.labels)).toEqual([["row0"], ["row1"], ["row2"]]);
  });

  it("reading time is the characters at 20 a second, and never under one second", () => {
    expect(CAPTION_CHARS_PER_SECOND).toBe(20);
    expect(readMs(40)).toBe(2000);
    expect(readMs(41)).toBe(2050);
    expect(readMs(3)).toBe(MOTION_MIN_CUE_MS);
    expect(readMs(20)).toBe(MOTION_MIN_CUE_MS);
  });

  it("short words: five seconds of motion, then the finished ad held two seconds", () => {
    const t = timelineOf(23, 40);
    expect(t).toMatchObject({ clip_ms: MOTION_CLIP_MS, hold_ms: MOTION_HOLD_MS, duration_ms: 7000 });
  });

  it("words read exactly as the motion ends leave the hold at two seconds; one frame more lengthens it", () => {
    // 60 + 40 characters: read at 3000 + 2000 = 5000, the clip's end.
    expect(timelineOf(60, 40).hold_ms).toBe(MOTION_HOLD_MS);
    const longer = timelineOf(60, 41);
    expect(longer.hold_ms).toBeGreaterThan(MOTION_HOLD_MS);
    expect(longer.hold_ms).toBeLessThanOrEqual(MOTION_HOLD_MS + 50 + 1000 / MOTION_FPS);
  });

  it("the last group is on screen for its reading time and two seconds more, whatever the words", () => {
    for (const chars of [[10], [23, 40], [60, 80], [35, 35, 35, 35]]) {
      const t = timelineOf(...chars);
      const last = t.cues.at(-1)!;
      expect(t.duration_ms - last.from_ms).toBeGreaterThanOrEqual(readMs(chars.at(-1)!) + MOTION_HOLD_MS);
    }
  });

  it("every cue falls on a frame of the fixed rate", () => {
    const t = timelineOf(23, 41, 37);
    const frames = (ms: number) => (ms * MOTION_FPS) / 1000;
    for (const c of t.cues) expect(Math.abs(frames(c.from_ms) - Math.round(frames(c.from_ms)))).toBeLessThan(0.02);
    expect(t.cues[1]!.from_ms).toBe(1167); // 1150 ms is between frames 34 and 35; drawn on 35
  });

  it("an ad at the fifteen-second limit is made; one whose words need more is refused, never sped up", () => {
    // read at 13000 → hold 10000 → 15000 exactly
    expect(timelineOf(130, 130).duration_ms).toBe(MOTION_MAX_MS);
    const over = motionTimeline([{ labels: ["a"], chars: 130 }, { labels: ["b"], chars: 131 }]);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.findings).toEqual([{ kind: "too_long", duration_ms: expect.any(Number), max_ms: MOTION_MAX_MS }]);
  });

  it("no words, and a group with no rows or no characters, are refused by name", () => {
    expect(motionTimeline([])).toEqual({ ok: false, findings: [{ kind: "no_words" }] });
    expect(motionTimeline([{ labels: ["headline"], chars: 20 }, { labels: [], chars: 10 }, { labels: ["cta"], chars: 0 }]))
      .toEqual({ ok: false, findings: [{ kind: "empty_group", index: 1 }, { kind: "empty_group", index: 2 }] });
  });

  it("rows that arrive together stay one cue", () => {
    const r = motionTimeline([{ labels: ["headline_figure", "headline"], chars: 30 }, { labels: ["subline"], chars: 20 }]);
    expect(r.ok && r.timeline.cues).toEqual([{ labels: ["headline_figure", "headline"], from_ms: 0 }, { labels: ["subline"], from_ms: 1500 }]);
  });

  it("is made in the feed's first format, the 4:5 Meta recommends for a feed video", () => {
    expect(MOTION_FORMAT).toBe(FEED_FORMATS[0]);
    expect(MOTION_FORMAT).toBe("4:5");
  });
});
