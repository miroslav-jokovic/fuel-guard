import { describe, expect, it } from "vitest";
import { stopScores } from "./assignments.js";
import type { AttemptRow, FilmStanding } from "./standing.js";

/**
 * What the office sees per film (SEGMENT-QUIZ D-TR16): right on the FIRST try out of every stop's
 * questions, tries per stop in stop order, and answers that came under 2 s after the one before.
 */
const VERSION = "v1";
const bank = [0, 1].flatMap((chapter) => [0, 1, 2].flatMap((point) => [0, 1].map((v) => ({ id: `c${chapter}p${point}v${v}`, version_id: VERSION, chapter, point, answer: "b" }))));
const film = {
  version: { id: VERSION, duration_ms: 200_000, chapters: [{ title: "One", startMs: 0 }, { title: "Two", startMs: 100_000 }] },
  bank,
} as unknown as FilmStanding;

const attempt = (chapter: number, versions: Array<[number, number]>, wrong: number[], times: number[] | null): AttemptRow => {
  const ids = versions.map(([p, v]) => `c${chapter}p${p}v${v}`);
  const start = Date.parse("2026-11-25T10:00:00Z");
  return {
    id: `a${chapter}${ids.join("")}`,
    assignment_id: "a",
    version_id: VERSION,
    served: ids.map((questionId) => ({ questionId, order: ["a", "b", "c", "d"] })),
    answers: Object.fromEntries(ids.map((id, i) => [id, wrong.includes(i) ? "a" : "b"])),
    answered_at: times ? Object.fromEntries(ids.map((id, i) => [id, new Date(start + times[i]!).toISOString()])) : null,
    correct: ids.length - wrong.length,
    passed: wrong.length === 0,
    missed_chapters: wrong.length ? [chapter] : [],
    started_at: new Date(start).toISOString(),
    submitted_at: "2026-11-25T10:05:00Z",
  };
};

describe("the office's view of a film's stops", () => {
  it("scores the first try only, counts tries per stop, and flags answers under 2 seconds", () => {
    const taken = [
      attempt(0, [[0, 0], [1, 0], [2, 0]], [1], [8000, 15_000, 16_000]), // stop 1: point 2 wrong; the third came 1 s after the second
      attempt(0, [[1, 1]], [], [9000]), // stop 1 again: the other version of point 2, right
      attempt(1, [[0, 0], [1, 0], [2, 0]], [], [500, 1000, 9000]), // stop 2: two tap-throughs
    ];
    expect(stopScores(film, taken)).toEqual({ firstTry: { correct: 5, total: 6 }, tries: [2, 1], fast: 3 });
  });

  it("says nothing of a film no stop of which was answered, and reads a quiz from before answer times as not fast", () => {
    expect(stopScores(film, [])).toEqual({ firstTry: null, tries: [0, 0], fast: 0 });
    expect(stopScores(film, [attempt(0, [[0, 0], [1, 0], [2, 0]], [], null)])).toEqual({ firstTry: { correct: 3, total: 3 }, tries: [1, 0], fast: 0 });
  });
});
