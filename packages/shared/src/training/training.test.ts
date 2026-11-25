import { describe, expect, it } from "vitest";
import {
  acceptableSpanMs,
  addWatched,
  chapterSpans,
  checkChapters,
  coveredMs,
  isWatched,
} from "./watching.js";
import { checkQuestion } from "./quiz.js";
import { assignedLessons, assignmentComplete, lessonStatuses } from "./course.js";

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
  const watch = { kind: "watch", stop: 0 } as const;
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
