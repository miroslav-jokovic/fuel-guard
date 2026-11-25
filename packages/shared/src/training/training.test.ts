import { describe, expect, it } from "vitest";
import {
  acceptableSpanMs,
  addWatched,
  chapterSpans,
  checkChapters,
  coveredMs,
  filmState,
  isWatched,
  type FilmProgress,
} from "./watching.js";
import { checkQuestion, drawQuiz, gradeQuiz, type PoolQuestion } from "./quiz.js";
import { assignedLessons, assignmentComplete, lessonStatuses } from "./course.js";

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

// Film 01's chapters and length (§2): 0:08 Why space · 1:26 Count it · 2:25 What it costs · 3:24.
const FILM01 = { durationMs: 204_400, chapters: [{ title: "Why space", startMs: 8000 }, { title: "Count it", startMs: 86_000 }, { title: "What it costs", startMs: 145_000 }] };

describe("watched ranges", () => {
  it("merges overlapping and nearly-touching spans and clamps to the film", () => {
    let r = addWatched([], [0, 10_000], 30_000);
    r = addWatched(r, [11_000, 20_000], 30_000); // 1 s gap: a heartbeat boundary, one span
    r = addWatched(r, [25_000, 40_000], 30_000); // past the end: clamped
    expect(r).toEqual([[0, 20_000], [25_000, 30_000]]);
  });

  it("ignores an empty or backwards span", () => {
    expect(addWatched([[0, 5000]], [9000, 9000], 30_000)).toEqual([[0, 5000]]);
    expect(addWatched([[0, 5000]], [9000, 8000], 30_000)).toEqual([[0, 5000]]);
  });

  it("counts coverage inside a window only", () => {
    expect(coveredMs([[0, 10_000], [20_000, 30_000]], 5000, 25_000)).toBe(10_000);
  });

  it("calls a window watched at 90 %, not before", () => {
    expect(isWatched([[0, 8999]], 0, 10_000)).toBe(false);
    expect(isWatched([[0, 9000]], 0, 10_000)).toBe(true);
  });

  it("a dragged bar is not watching: a span longer than the time since the last report is refused", () => {
    expect(acceptableSpanMs(10_000)).toBe(15_500);
    expect(acceptableSpanMs(null)).toBe(15_500);
    expect(acceptableSpanMs(10 * 60_000)).toBe(120_000);
  });
});

describe("chapters", () => {
  it("ends each chapter where the next begins, and the last at the film's end", () => {
    const s = chapterSpans(FILM01.chapters, FILM01.durationMs);
    expect(s.map((c) => [c.startMs, c.endMs])).toEqual([[8000, 86_000], [86_000, 145_000], [145_000, 204_400]]);
  });

  it("treats a film with no chapters as one chapter", () => {
    expect(chapterSpans([], 60_000)).toEqual([{ index: 0, title: "Whole video", startMs: 0, endMs: 60_000 }]);
  });

  it("refuses chapters out of order, too close, untitled or outside the film", () => {
    expect(checkChapters(FILM01.chapters, FILM01.durationMs)).toBeNull();
    expect(checkChapters([{ title: "A", startMs: 0 }, { title: "B", startMs: 3000 }], 60_000)).toMatch(/less than 5 seconds/);
    expect(checkChapters([{ title: "A", startMs: 9000 }, { title: "B", startMs: 1000 }], 60_000)).toMatch(/less than 5 seconds/);
    expect(checkChapters([{ title: " ", startMs: 0 }], 60_000)).toMatch(/needs a title/);
    expect(checkChapters([{ title: "A", startMs: 60_000 }], 60_000)).toMatch(/outside/);
  });
});

describe("what unlocks the quiz (D-TR8)", () => {
  const base: FilmProgress = { ...FILM01, watched: [], watchedSince: [], lastQuiz: null };

  it("opens the quiz once the film is watched to 90 %", () => {
    expect(filmState(base).kind).toBe("watch");
    expect(filmState({ ...base, watched: [[0, 184_000]] }).kind).toBe("quiz");
  });

  it("after a fail asks only for the missed chapters, watched since the fail", () => {
    const failed: FilmProgress = { ...base, watched: [[0, 204_400]], lastQuiz: { passed: false, missedChapters: [0, 2] } };
    expect(filmState(failed)).toEqual({ kind: "rewatch", chapters: [0, 2] });
    // Chapter 1 (the one NOT missed) watched again does nothing.
    expect(filmState({ ...failed, watchedSince: [[86_000, 145_000]] })).toEqual({ kind: "rewatch", chapters: [0, 2] });
    expect(filmState({ ...failed, watchedSince: [[8000, 86_000]] })).toEqual({ kind: "rewatch", chapters: [2] });
    expect(filmState({ ...failed, watchedSince: [[8000, 86_000], [145_000, 204_400]] }).kind).toBe("quiz");
  });

  it("a pass is final", () => {
    expect(filmState({ ...base, lastQuiz: { passed: true, missedChapters: [1] } }).kind).toBe("passed");
  });
});

const pool: PoolQuestion[] = Array.from({ length: 10 }, (_, i) => ({
  id: `q${i}`,
  chapter: i < 6 ? 0 : i < 8 ? 1 : 2, // six about chapter 0, two each about 1 and 2
  prompt: `Question ${i}`,
  choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }],
  answer: "b",
  why: "Because.",
}));

describe("drawing a quiz", () => {
  it("draws the asked number, no repeats, every choice kept", () => {
    const s = drawQuiz(pool, 5, seeded(1));
    expect(s).toHaveLength(5);
    expect(new Set(s.map((q) => q.questionId)).size).toBe(5);
    for (const q of s) expect([...q.order].sort()).toEqual(["a", "b", "c"]);
  });

  it("asks about every chapter even when the pool leans on one", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const chapters = new Set(drawQuiz(pool, 5, seeded(seed)).map((q) => pool.find((p) => p.id === q.questionId)!.chapter));
      expect(chapters).toEqual(new Set([0, 1, 2]));
    }
  });

  it("gives a retake new questions while the pool has them", () => {
    const first = drawQuiz(pool, 5, seeded(7));
    const again = drawQuiz(pool, 5, seeded(8), new Set(first.map((q) => q.questionId)));
    expect(again.filter((q) => first.some((f) => f.questionId === q.questionId))).toHaveLength(0);
  });

  it("falls back to seen questions when the pool is too small", () => {
    const small = pool.slice(0, 6);
    const first = drawQuiz(small, 5, seeded(3));
    expect(drawQuiz(small, 5, seeded(4), new Set(first.map((q) => q.questionId)))).toHaveLength(5);
  });
});

describe("grading", () => {
  const served = drawQuiz(pool, 5, seeded(11));
  const ids = served.map((s) => s.questionId);
  const all = (choice: string) => Object.fromEntries(ids.map((id) => [id, choice]));

  it("passes at the pass count and names the missed chapters once each", () => {
    expect(gradeQuiz(served, pool, all("b"), 4)).toEqual({ correct: 5, total: 5, passed: true, missedChapters: [] });
    const g = gradeQuiz(served, pool, all("a"), 4);
    expect(g.passed).toBe(false);
    expect(g.correct).toBe(0);
    expect(g.missedChapters).toEqual([...new Set(ids.map((id) => pool.find((p) => p.id === id)!.chapter))].sort());
  });

  it("counts an unanswered question as wrong", () => {
    const answers = all("b");
    delete answers[ids[0]!];
    expect(gradeQuiz(served, pool, answers, 4)).toMatchObject({ correct: 4, passed: true });
    delete answers[ids[1]!];
    expect(gradeQuiz(served, pool, answers, 4)).toMatchObject({ correct: 3, passed: false });
  });
});

describe("a question the office writes", () => {
  const ok = { chapter: 0, prompt: "How far?", choices: ["200 ft", "419 ft"], answerIndex: 1, why: "142 + 61 + 216." };
  it("accepts a complete one and names what is missing otherwise", () => {
    expect(checkQuestion(ok, 3)).toBeNull();
    expect(checkQuestion({ ...ok, choices: ["419 ft"] }, 3)).toMatch(/2 to 5/);
    expect(checkQuestion({ ...ok, choices: ["419 ft", "419 FT"] }, 3)).toMatch(/same/);
    expect(checkQuestion({ ...ok, answerIndex: 2 }, 3)).toMatch(/right answer/);
    expect(checkQuestion({ ...ok, why: "" }, 3)).toMatch(/why/);
    expect(checkQuestion({ ...ok, chapter: 3 }, 3)).toMatch(/chapter/);
    expect(checkQuestion({ ...ok, chapter: 0 }, 0)).toBeNull(); // no chapters = one
  });
});

describe("a course, in order", () => {
  const watch = { kind: "watch" } as const;
  const passed = { kind: "passed" } as const;
  it("opens the next film only after the one before is passed", () => {
    expect(lessonStatuses([{ lessonId: "1", film: passed }, { lessonId: "2", film: watch }, { lessonId: "3", film: watch }]).map((s) => s.status)).toEqual([
      "passed",
      "watch",
      "locked",
    ]);
  });

  it("skips a film with nothing published, and is complete when every film is passed", () => {
    const s = lessonStatuses([{ lessonId: "1", film: passed }, { lessonId: "2", film: null }, { lessonId: "3", film: passed }]);
    expect(s.map((x) => x.lessonId)).toEqual(["1", "3"]);
    expect(assignmentComplete(s)).toBe(true);
    expect(assignmentComplete([])).toBe(false);
  });

  it("an assignment of single films keeps the course's order", () => {
    const lessons = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(assignedLessons(lessons, ["c", "a"]).map((l) => l.id)).toEqual(["a", "c"]);
    expect(assignedLessons(lessons, null)).toHaveLength(3);
  });
});
