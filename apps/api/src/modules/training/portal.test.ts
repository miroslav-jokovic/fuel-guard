import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { hashLinkToken, mintLinkToken } from "./media.js";
import { answer, recordProgress, resolveLink, startQuiz, type Link } from "./portal.js";

/**
 * The driver's link page (D-TR2; SEGMENT-QUIZ D-TR13–D-TR15): what the token opens; that a stop's
 * questions reach the phone without their answers and only once its segment is watched; that a miss
 * reveals nothing, reopens the segment and then asks the OTHER version; that grading is the server's
 * and the first answer counts; and that a dragged bar is not watching. Every query names the link's org.
 */

const ORG = "33333333-3333-4333-8333-333333333333";
const A_ID = "44444444-4444-4444-8444-444444444444";
const COURSE = "55555555-5555-4555-8555-555555555555";
const LESSON = "66666666-6666-4666-8666-666666666666";
const VERSION = "77777777-7777-4777-8777-777777777777";
const ATTEMPT = "88888888-8888-4888-8888-888888888888";
const DUR = 204_400;

const assignment = (over: Record<string, unknown> = {}) => ({
  org_id: ORG,
  id: A_ID,
  driver_id: "d1",
  course_id: COURSE,
  lesson_ids: null,
  due_on: null,
  link_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  last_sent_at: null,
  last_sent_via: null,
  first_opened_at: "2026-11-24T10:00:00Z",
  completed_at: null,
  revoked_at: null,
  created_at: "2026-11-24T09:00:00Z",
  ...over,
});
const link: Link = { orgId: ORG, assignment: assignment() as unknown as Link["assignment"] };

// Two segments ("One" 0:00–1:40, "Two" 1:40–3:24), 3 points each, 2 versions per point: 12 questions.
const qid = (chapter: number, point: number, v: number) => `9999999${chapter}-99${point}${v}-4999-8999-999999999999`;
const questions = [0, 1].flatMap((chapter) =>
  [0, 1, 2].flatMap((point) =>
    [0, 1].map((v) => ({
      id: qid(chapter, point, v),
      version_id: VERSION,
      chapter,
      point,
      prompt: `Stop ${chapter + 1}, point ${point + 1}, version ${v + 1}?`,
      choices: [{ id: "a", text: "Wrong" }, { id: "b", text: "Right" }, { id: "c", text: "Also wrong" }, { id: "d", text: "Not this" }],
      answer: "b",
      why: "Because the film says so.",
    })),
  ),
);
const version = { id: VERSION, lesson_id: LESSON, version_no: 1, duration_ms: DUR, chapters: [{ title: "One", startMs: 0 }, { title: "Two", startMs: 100_000 }], renditions: [{ height: 360, path: "p/360.mp4", bytes: 1 }], poster_path: "p/poster.jpg", captions_path: null, serve_count: 3, pass_count: 3 };

function world(opts: { watched?: Array<[number, number]>; since?: Array<[number, number]>; attempts?: unknown[] | ((q: RecordedQuery) => unknown[]); progressAt?: string } = {}) {
  const progress = opts.watched
    ? [{ assignment_id: A_ID, version_id: VERSION, watched: opts.watched, watched_since: opts.since ?? [], position_ms: 0, updated_at: opts.progressAt ?? new Date(Date.now() - 10_000).toISOString() }]
    : [];
  return createSupabaseRecorder({
    tables: {
      training_assignments: (q: RecordedQuery) => (q.filters().some((f) => f.col === "token_hash" && f.val === hashLinkToken("x".repeat(24))) ? [assignment()] : []),
      training_lessons: [{ id: LESSON, course_id: COURSE, title: "Following Too Close", position: 0, retired_at: null }],
      training_versions: [version],
      training_progress: progress,
      training_attempts: opts.attempts ?? [],
      training_questions: questions,
    },
  });
}

describe("the link", () => {
  it("opens one assignment by the hash of its token, and nothing for a malformed, unknown, cancelled or expired one", async () => {
    const rec = world();
    expect(await resolveLink(rec.client, "x".repeat(24))).toMatchObject({ orgId: ORG, assignment: { id: A_ID } });
    expect(await resolveLink(rec.client, "short")).toMatchObject({ status: 404 });
    expect(await resolveLink(rec.client, "y".repeat(24))).toMatchObject({ status: 404 });
    const cancelled = createSupabaseRecorder({ tables: { training_assignments: [assignment({ revoked_at: "2026-11-24T11:00:00Z" })] } });
    expect(await resolveLink(cancelled.client, "x".repeat(24))).toMatchObject({ status: 404 });
    const old = createSupabaseRecorder({ tables: { training_assignments: [assignment({ link_expires_at: "2026-01-01T00:00:00Z" })] } });
    expect(await resolveLink(old.client, "x".repeat(24))).toMatchObject({ status: 410 });
  });

  it("mints a 24-character token whose hash is what is stored", () => {
    const { token, hash } = mintLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(hash).toBe(hashLinkToken(token));
    expect(hash).not.toContain(token);
  });
});

describe("watching", () => {
  it("keeps a span no longer than the time since the last report, and drops a dragged bar", async () => {
    const rec = world({ watched: [[0, 10_000]] });
    await recordProgress(rec.client, link, { versionId: VERSION, fromMs: 10_000, toMs: 20_000, positionMs: 20_000 });
    expect(rec.writtenRows("training_progress")[0]).toMatchObject({ watched: [[0, 20_000]] });

    const dragged = world({ watched: [[0, 10_000]] });
    await recordProgress(dragged.client, link, { versionId: VERSION, fromMs: 10_000, toMs: 190_000, positionMs: 190_000 });
    expect(dragged.writtenRows("training_progress")[0]).toMatchObject({ watched: [[0, 10_000]], position_ms: 190_000 });
    expectOrgScoped(rec, ORG);
  });

  it("refuses a stop's questions until its segment is watched", async () => {
    const rec = world({ watched: [[0, 60_000]] }); // 60 % of 0:00–1:40
    expect(await startQuiz(rec.client, link, VERSION)).toMatchObject({ status: 409, code: "watch_first" });
  });
});

/** A submitted attempt on stop 1 that served version 1 of each point and got `wrong` points wrong. */
const takenStop1 = (wrong: number[]) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  assignment_id: A_ID,
  version_id: VERSION,
  served: [0, 1, 2].map((p) => ({ questionId: qid(0, p, 0), order: ["a", "b", "c", "d"] })),
  answers: Object.fromEntries([0, 1, 2].map((p) => [qid(0, p, 0), wrong.includes(p) ? "a" : "b"])),
  answered_at: null,
  correct: 3 - wrong.length,
  passed: wrong.length === 0,
  missed_chapters: wrong.length ? [0] : [],
  started_at: "2026-11-24T10:00:00Z",
  submitted_at: "2026-11-24T10:01:00Z",
});
/** Attempts: the given ones, plus whatever startQuiz inserts (returned as written). */
const attemptsWith = (taken: unknown[]) => (q: RecordedQuery) =>
  q.write ? [{ id: ATTEMPT, assignment_id: A_ID, version_id: VERSION, served: (q.write.payload as { served: unknown }).served, answers: null, answered_at: null, started_at: new Date().toISOString(), submitted_at: null }] : taken;

describe("a stop's questions (D-TR13, D-TR14)", () => {
  it("reach the phone once the segment is watched: one per point, every choice, no answer and no reason", async () => {
    const rec = world({ watched: [[0, 100_000]], attempts: attemptsWith([]) });
    const quiz = await startQuiz(rec.client, link, VERSION);
    if ("refused" in quiz) throw new Error(quiz.message);
    expect(quiz).toMatchObject({ chapter: 0, chapterTitle: "One" });
    expect(quiz.questions).toHaveLength(3);
    expect(new Set(quiz.questions.map((q) => questions.find((x) => x.id === q.id)!.point))).toEqual(new Set([0, 1, 2]));
    expect(quiz.questions.every((q) => questions.find((x) => x.id === q.id)!.chapter === 0)).toBe(true);
    expect(JSON.stringify(quiz)).not.toMatch(/"answer"|Because the film/);
    for (const q of quiz.questions) expect(q.choices.map((c) => c.text).sort()).toEqual(["Also wrong", "Not this", "Right", "Wrong"]);
    expect(rec.writtenRows("training_attempts")[0]).toMatchObject({ org_id: ORG, assignment_id: A_ID, version_id: VERSION });
    expectOrgScoped(rec, ORG);
  });

  it("never opens stop 2 before stop 1 is passed, even with the whole film watched", async () => {
    const rec = world({ watched: [[0, DUR]], attempts: attemptsWith([]) });
    const quiz = await startQuiz(rec.client, link, VERSION);
    if ("refused" in quiz) throw new Error(quiz.message);
    expect(quiz.chapter).toBe(0);
  });

  it("opens stop 2 once stop 1 is passed and segment 2 is watched", async () => {
    const rec = world({ watched: [[0, DUR]], attempts: attemptsWith([takenStop1([])]) });
    const quiz = await startQuiz(rec.client, link, VERSION);
    if ("refused" in quiz) throw new Error(quiz.message);
    expect(quiz).toMatchObject({ chapter: 1, chapterTitle: "Two" });
  });
});

describe("after a miss (D-TR15)", () => {
  it("asks nothing until the segment is watched again since the miss", async () => {
    const rec = world({ watched: [[0, 100_000]], attempts: attemptsWith([takenStop1([1])]) });
    expect(await startQuiz(rec.client, link, VERSION)).toMatchObject({ status: 409, code: "watch_first", message: "Watch this part again first." });
  });

  it("then asks only the missed point, as its OTHER version", async () => {
    const rec = world({ watched: [[0, 100_000]], since: [[0, 100_000]], attempts: attemptsWith([takenStop1([1])]) });
    const quiz = await startQuiz(rec.client, link, VERSION);
    if ("refused" in quiz) throw new Error(quiz.message);
    expect(quiz.questions.map((q) => q.id)).toEqual([qid(0, 1, 1)]);
  });
});

describe("answering", () => {
  const open = (answers: Record<string, string> | null, served = [0, 1, 2].map((p) => qid(0, p, 0))) => ({
    id: ATTEMPT,
    assignment_id: A_ID,
    version_id: VERSION,
    served: served.map((questionId) => ({ questionId, order: ["a", "b", "c", "d"] })),
    answers,
    answered_at: null,
    correct: null,
    passed: null,
    missed_chapters: null,
    started_at: "2026-11-24T10:00:00Z",
    submitted_at: null,
  });
  const quizWorld = (answers: Record<string, string> | null) =>
    createSupabaseRecorder({ tables: { training_attempts: [open(answers)], training_questions: questions, training_versions: [version], training_progress: [], training_lessons: [] } });

  it("a wrong answer learns nothing: no right answer, no reason", async () => {
    const out = await answer(quizWorld(null).client, link, { attemptId: ATTEMPT, questionId: qid(0, 0, 0), choiceId: "a" });
    expect(out).toEqual({ feedback: { right: false, answer: null, why: null, chapter: 0 }, result: null });
  });

  it("a right answer gets its reason", async () => {
    const out = await answer(quizWorld(null).client, link, { attemptId: ATTEMPT, questionId: qid(0, 0, 0), choiceId: "b" });
    expect(out).toMatchObject({ feedback: { right: true, answer: "b", why: "Because the film says so." } });
  });

  it("keeps the FIRST answer to a question, and when it came", async () => {
    const rec = quizWorld({ [qid(0, 0, 0)]: "a" });
    const out = await answer(rec.client, link, { attemptId: ATTEMPT, questionId: qid(0, 0, 0), choiceId: "b" });
    expect(out).toMatchObject({ feedback: { right: false }, result: null });
    const w = rec.writtenRows("training_attempts")[0]!;
    expect(w).toMatchObject({ answers: { [qid(0, 0, 0)]: "a" } });
    expect(Date.parse((w.answered_at as Record<string, string>)[qid(0, 0, 0)]!)).toBeGreaterThan(0);
  });

  it("submits on the last answer: one wrong of three is a miss, and opens the rewatch fresh", async () => {
    const rec = quizWorld({ [qid(0, 0, 0)]: "b", [qid(0, 1, 0)]: "a" });
    const out = await answer(rec.client, link, { attemptId: ATTEMPT, questionId: qid(0, 2, 0), choiceId: "b" });
    expect(out).toMatchObject({ result: { correct: 2, total: 3, passed: false, missedChapters: [0] } });
    expect(rec.writtenRows("training_attempts")[0]).toMatchObject({ passed: false, correct: 2, missed_chapters: [0] });
    expect(rec.writtenRows("training_progress")[0]).toEqual({ watched_since: [] });
    expectOrgScoped(rec, ORG);
  });

  it("refuses an answer to a question the stop did not serve, or to a finished one", async () => {
    expect(await answer(quizWorld(null).client, link, { attemptId: ATTEMPT, questionId: qid(1, 0, 0), choiceId: "b" })).toMatchObject({ status: 422 });
    const done = createSupabaseRecorder({ tables: { training_attempts: [{ ...open({}), submitted_at: "2026-11-24T10:05:00Z" }] } });
    expect(await answer(done.client, link, { attemptId: ATTEMPT, questionId: qid(0, 0, 0), choiceId: "b" })).toMatchObject({ status: 409 });
  });
});
