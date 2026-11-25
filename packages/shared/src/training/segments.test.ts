import { describe, expect, it } from "vitest";
import { filmState, publishBlockers, segmentsOf, type FilmProgress, type PointResult, type SegmentQuestion } from "./segments.js";
import { drawSegment, gradeQuiz, type PoolQuestion } from "./quiz.js";

/**
 * Questions after each segment (SEGMENT-QUIZ-2026-11-25.md, D-TR13–D-TR17): film 01's real marks
 * (0:08 Why space · 1:26 Count it · 2:25 What it costs · 3:16 Closing, 3:24 long), 3 points per segment,
 * 2 versions per point — the 18 questions the bank writes for it.
 */

/** A deterministic random source (mulberry32), so a draw is reproducible in a test. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHAPTERS = [
  { title: "Why space", startMs: 8000 },
  { title: "Count it", startMs: 86_000 },
  { title: "What it costs", startMs: 145_000 },
  { title: "Closing", startMs: 196_000 },
];
const DURATION = 204_400;
const BANK: PoolQuestion[] = [0, 1, 2].flatMap((chapter) =>
  [0, 1, 2].flatMap((point) =>
    ["A", "B"].map((v) => ({
      id: `c${chapter}p${point}${v}`,
      chapter,
      point,
      prompt: `Stop ${chapter + 1}, point ${point + 1}, version ${v}?`,
      choices: ["a", "b", "c", "d"].map((id) => ({ id, text: id.toUpperCase() })),
      answer: "b",
      why: "Because the film says so.",
    })),
  ),
);
const Q: SegmentQuestion[] = BANK;
const base: FilmProgress = { durationMs: DURATION, chapters: CHAPTERS, questions: Q, watched: [], watchedSince: [], results: [] };
const right = (chapter: number, points = [0, 1, 2]): PointResult[] => points.map((point) => ({ chapter, point, right: true }));

describe("a film's segments", () => {
  it("are the chapters with questions; the intro and the closing card are not stops", () => {
    expect(segmentsOf(CHAPTERS, DURATION, Q).map((s) => [s.chapter, s.startMs, s.endMs, s.points])).toEqual([
      [0, 8000, 86_000, [0, 1, 2]],
      [1, 86_000, 145_000, [0, 1, 2]],
      [2, 145_000, 196_000, [0, 1, 2]],
    ]);
  });
});

describe("where a driver stands (D-TR13, D-TR14)", () => {
  it("watches to the first stop, then gets its questions — and only once the segment is watched", () => {
    expect(filmState(base)).toEqual({ kind: "watch", stop: 0 });
    expect(filmState({ ...base, watched: [[0, 70_000]] })).toEqual({ kind: "watch", stop: 0 }); // 80 % of 0:08–1:26
    expect(filmState({ ...base, watched: [[0, 86_000]] })).toEqual({ kind: "quiz", stop: 0, points: [0, 1, 2] });
  });

  it("goes on to the next stop only with all 3 right", () => {
    const watched: FilmProgress["watched"] = [[0, 145_000]];
    expect(filmState({ ...base, watched, results: right(0) })).toEqual({ kind: "quiz", stop: 1, points: [0, 1, 2] });
    expect(filmState({ ...base, watched, results: right(0, [0, 2]) })).toMatchObject({ kind: "rewatch" });
  });

  it("never opens a later stop before an earlier one is passed, even with the whole film watched", () => {
    const all: FilmProgress = { ...base, watched: [[0, DURATION]] };
    expect(filmState(all)).toEqual({ kind: "quiz", stop: 0, points: [0, 1, 2] });
    expect(filmState({ ...all, results: [...right(1), ...right(2)] })).toEqual({ kind: "quiz", stop: 0, points: [0, 1, 2] });
  });

  it("after a miss: the segment watched again since the miss, then only the missed point (D-TR15)", () => {
    const missed: FilmProgress = { ...base, watched: [[0, 86_000]], results: [...right(0, [0, 2]), { chapter: 0, point: 1, right: false }] };
    expect(filmState(missed)).toEqual({ kind: "rewatch", chapters: [0] });
    expect(filmState({ ...missed, watchedSince: [[86_000, 145_000]] })).toEqual({ kind: "rewatch", chapters: [0] }); // the wrong segment
    expect(filmState({ ...missed, watchedSince: [[8000, 86_000]] })).toEqual({ kind: "quiz", stop: 0, points: [1] });
  });

  it("keeps a point right once it was answered right, and passes when every stop is", () => {
    const later: PointResult[] = [...right(0, [0, 2]), { chapter: 0, point: 1, right: false }, ...right(0, [1])];
    expect(filmState({ ...base, watched: [[0, 145_000]], results: later })).toEqual({ kind: "quiz", stop: 1, points: [0, 1, 2] });
    expect(filmState({ ...base, watched: [[0, DURATION]], results: [...later, ...right(1), ...right(2)] })).toEqual({ kind: "passed" });
  });

  it("a film with no questions is done once watched", () => {
    expect(filmState({ ...base, questions: [] })).toEqual({ kind: "watch", stop: null });
    expect(filmState({ ...base, questions: [], watched: [[0, DURATION]] })).toEqual({ kind: "passed" });
  });
});

describe("one stop's questions (D-TR15)", () => {
  it("asks one version of each point, every choice kept", () => {
    const s = drawSegment(BANK, 0, [0, 1, 2], new Map(), seeded(1));
    expect(s.map((x) => x.questionId.slice(0, 4))).toEqual(["c0p0", "c0p1", "c0p2"]);
    for (const q of s) expect([...q.order].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("a retry asks the OTHER version of the missed point, whatever the dice say", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const first = drawSegment(BANK, 0, [1], new Map(), seeded(seed))[0]!;
      const again = drawSegment(BANK, 0, [1], new Map([[first.questionId, 1]]), seeded(seed + 100))[0]!;
      expect(again.questionId).not.toBe(first.questionId);
      expect(again.questionId.slice(0, 4)).toBe("c0p1");
    }
  });

  it("passes only with every answer right", () => {
    const served = drawSegment(BANK, 0, [0, 1, 2], new Map(), seeded(2));
    const all = (c: string) => Object.fromEntries(served.map((s) => [s.questionId, c]));
    expect(gradeQuiz(served, BANK, all("b"))).toEqual({ correct: 3, total: 3, passed: true, missedChapters: [] });
    const two = { ...all("b"), [served[1]!.questionId]: "a" };
    expect(gradeQuiz(served, BANK, two)).toEqual({ correct: 2, total: 3, passed: false, missedChapters: [0] });
  });
});

describe("what blocks publishing", () => {
  const ready = { state: "ready", chapters: CHAPTERS };
  it("nothing, for film 01's 18 questions", () => {
    expect(publishBlockers({ ...ready, questions: Q })).toEqual([]);
  });
  it("names the segment with too few points, and the point with one version", () => {
    const short = Q.filter((q) => !(q.chapter === 1 && q.point === 2));
    expect(publishBlockers({ ...ready, questions: short })).toEqual(['"Count it" tests 2 points: each stop asks exactly 3.']);
    const single = BANK.filter((q) => q.id !== "c2p0B");
    expect(publishBlockers({ ...ready, questions: single })).toEqual(['"What it costs", point 1 has one version: write a second, so a retry asks something different.']);
  });
  it("needs at least one segment with questions, and a ready video", () => {
    expect(publishBlockers({ ...ready, questions: [] })).toEqual(["Write the questions for at least one segment."]);
    expect(publishBlockers({ ...ready, state: "processing", questions: Q })).toEqual(["The video is not ready for phones yet."]);
  });
});
