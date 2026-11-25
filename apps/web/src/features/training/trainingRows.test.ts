import { describe, expect, it } from "vitest";
import { publishBlockers, type TrainingAssignmentRow, type TrainingLessonSummary, type TrainingVersionSummary } from "@silvicom/shared";
import { chapterAt, clock, lessonCell, parseClock, questionsPerSegment, reachLabel, standing, withChapter, workingVersion } from "./trainingRows";

const FULL = [0, 1].flatMap((chapter) => [0, 1, 2].flatMap((point) => [{ chapter, point }, { chapter, point }]));
const version = (over: Partial<TrainingVersionSummary>): TrainingVersionSummary => ({
  id: "v", versionNo: 1, language: "en", state: "ready", durationMs: 204_000, chapters: [{ title: "The rule", startMs: 8000 }, { title: "Turns", startMs: 69_000 }], serveCount: 3, passCount: 3,
  questionCount: 12, questions: FULL, processError: null, posterUrl: null, publishedAt: null, ...over,
});

describe("times on the page", () => {
  it("reads and writes m:ss", () => {
    expect(clock(204_000)).toBe("3:24");
    expect(clock(null)).toBe("—");
    expect(parseClock("3:24")).toBe(204_000);
    expect(parseClock(" 0:08 ")).toBe(8_000);
    for (const bad of ["3:60", "324", "a:bc", ""]) expect(parseClock(bad), bad).toBeNull();
  });
});

describe("which version the office works on", () => {
  const lesson = (versions: TrainingVersionSummary[]): TrainingLessonSummary => ({ id: "l", title: "Backing", position: 0, retiredAt: null, versions });
  it("is a new upload still being edited, ahead of the live cut", () => {
    expect(workingVersion(lesson([version({ id: "v2", state: "processing" }), version({ id: "v1", state: "published" })]))?.id).toBe("v2");
  });
  it("is the live cut when nothing newer is being edited, and none for a film never uploaded", () => {
    expect(workingVersion(lesson([version({ id: "v1", state: "published" }), version({ id: "v0", state: "withdrawn" })]))?.id).toBe("v1");
    expect(workingVersion(lesson([]))).toBeNull();
  });
});

describe("what stops a publish (the shared rule the API also refuses with)", () => {
  it("names a film not ready, and the segment short of its 3 points", () => {
    expect(publishBlockers(version({}))).toEqual([]);
    expect(publishBlockers(version({ state: "processing" }))).toEqual(["The video is not ready for phones yet."]);
    expect(publishBlockers(version({ questions: FULL.filter((q) => q.chapter === 0 || q.point < 2) }))).toEqual(['"Turns" tests 2 points: each stop asks exactly 3.']);
  });
});

describe("chapters", () => {
  const ch = [{ title: "Rule", startMs: 0 }, { title: "Turns", startMs: 69_000 }];
  it("finds the chapter a moment falls in", () => {
    expect(chapterAt(ch, 10_000)).toBe(0);
    expect(chapterAt(ch, 69_000)).toBe(1);
  });
  it("puts a new mark in time order, and a mark on an existing start replaces it", () => {
    expect(withChapter(ch, { title: "Rail", startMs: 30_000 }).map((c) => c.title)).toEqual(["Rule", "Rail", "Turns"]);
    expect(withChapter(ch, { title: "Turning", startMs: 69_400 }).map((c) => c.title)).toEqual(["Rule", "Turning"]);
  });
});

describe("how a driver gets the link (D-TR11)", () => {
  it("is a text only when the API says so, then email, then the office sends it", () => {
    expect(reachLabel({ sms: true, smsReason: null, email: "a@b.c" }).via).toBe("sms");
    expect(reachLabel({ sms: false, smsReason: "Texting hired drivers is not set up yet.", email: "a@b.c" })).toEqual({ via: "email", label: "Email", detail: "Texting hired drivers is not set up yet." });
    expect(reachLabel({ sms: false, smsReason: null, email: null }).via).toBe("copy");
    expect(reachLabel(undefined).via).toBeNull();
  });
});

describe("where a sent training stands", () => {
  const row = (over: Partial<TrainingAssignmentRow>): TrainingAssignmentRow => ({
    id: "a", driverId: "d", driverName: "Ana", courseId: "c", courseTitle: "Act I", sentAt: "2026-11-20T10:00:00Z", lastSentVia: "email",
    dueOn: null, firstOpenedAt: null, completedAt: null, revokedAt: null, lessons: [], ...over,
  });
  it("puts cancelled and finished ahead of a due date, and reads the due date as a calendar day", () => {
    expect(standing(row({ revokedAt: "x", completedAt: "y" }), "2026-11-25")).toBe("cancelled");
    expect(standing(row({ completedAt: "y", dueOn: "2026-11-01" }), "2026-11-25")).toBe("finished");
    expect(standing(row({ dueOn: "2026-11-24" }), "2026-11-25")).toBe("overdue");
    expect(standing(row({ dueOn: "2026-11-25" }), "2026-11-25")).toBe("not_opened"); // due today is not late
    expect(standing(row({ firstOpenedAt: "x" }), "2026-11-25")).toBe("in_progress");
  });
  it("shows a film's best score beside its status", () => {
    expect(lessonCell({ lessonId: "l", title: "t", status: "rewatch", watchedMs: 0, durationMs: 1, firstTry: { correct: 8, total: 9 }, tries: [1, 3, 0], fast: 2, attempts: 4 })).toBe(
      "Watching again · 8/9 first try · stop 2: 3 tries · 2 too fast",
    );
    expect(lessonCell({ lessonId: "l", title: "t", status: "locked", watchedMs: 0, durationMs: 1, firstTry: null, tries: [0, 0, 0], fast: 0, attempts: 0 })).toBe("Not started");
  });
  it("counts questions per stop for the Videos table", () => {
    expect(questionsPerSegment(version({}))).toBe("6 · 6");
    expect(questionsPerSegment(version({ questions: [] }))).toBe("—");
  });
});
