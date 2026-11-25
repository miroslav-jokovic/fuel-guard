import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { hashLinkToken, mintLinkToken } from "./media.js";
import { answer, recordProgress, resolveLink, startQuiz, type Link } from "./portal.js";

/**
 * The driver's link page (D-TR2, D-TR7, D-TR8): what the token opens, that the quiz reaches the phone
 * without its answers, that grading is the server's and the first answer counts, that a fail reopens
 * only the rewatch, and that a dragged bar is not watching. Every query names the link's own org.
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

const questions = Array.from({ length: 6 }, (_, i) => ({
  id: `9999999${i}-9999-4999-8999-999999999999`,
  chapter: i % 2,
  prompt: `Question ${i}?`,
  choices: [{ id: "a", text: "Wrong" }, { id: "b", text: "Right" }],
  answer: "b",
  why: "Because the film says so.",
}));
const version = { id: VERSION, lesson_id: LESSON, version_no: 1, duration_ms: DUR, chapters: [{ title: "One", startMs: 0 }, { title: "Two", startMs: 100_000 }], renditions: [{ height: 360, path: "p/360.mp4", bytes: 1 }], poster_path: "p/poster.jpg", captions_path: null, serve_count: 5, pass_count: 4 };

function world(opts: { watched?: Array<[number, number]>; attempts?: unknown[]; progressAt?: string } = {}) {
  const progress = opts.watched
    ? [{ assignment_id: A_ID, version_id: VERSION, watched: opts.watched, watched_since: [], position_ms: 0, updated_at: opts.progressAt ?? new Date(Date.now() - 10_000).toISOString() }]
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

  it("refuses the quiz until the film is watched", async () => {
    const rec = world({ watched: [[0, 60_000]] });
    expect(await startQuiz(rec.client, link, VERSION)).toMatchObject({ status: 409, code: "watch_first" });
  });
});

describe("the quiz", () => {
  it("reaches the phone with every choice and no answer, and is kept as served", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        training_lessons: [{ id: LESSON, course_id: COURSE, title: "Film", position: 0, retired_at: null }],
        training_versions: [version],
        training_progress: [{ assignment_id: A_ID, version_id: VERSION, watched: [[0, DUR]], watched_since: [], position_ms: DUR, updated_at: new Date().toISOString() }],
        training_attempts: (q: RecordedQuery) =>
          q.write ? [{ id: ATTEMPT, assignment_id: A_ID, version_id: VERSION, served: (q.write.payload as { served: unknown }).served, answers: null, submitted_at: null }] : [],
        training_questions: questions,
      },
    });
    const quiz = await startQuiz(rec.client, link, VERSION);
    if ("refused" in quiz) throw new Error(quiz.message);
    expect(quiz.questions).toHaveLength(5);
    expect(JSON.stringify(quiz)).not.toMatch(/"answer"|Because the film/);
    for (const q of quiz.questions) expect(q.choices.map((c) => c.text).sort()).toEqual(["Right", "Wrong"]);
    expect(rec.writtenRows("training_attempts")[0]).toMatchObject({ org_id: ORG, assignment_id: A_ID, version_id: VERSION });
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  const open = (answers: Record<string, string> | null) => ({
    id: ATTEMPT,
    assignment_id: A_ID,
    version_id: VERSION,
    served: questions.slice(0, 5).map((q) => ({ questionId: q.id, order: ["a", "b"] })),
    answers,
    correct: null,
    passed: null,
    missed_chapters: null,
    started_at: "2026-11-24T10:00:00Z",
    submitted_at: null,
  });
  const quizWorld = (answers: Record<string, string> | null) =>
    createSupabaseRecorder({ tables: { training_attempts: [open(answers)], training_questions: questions, training_versions: [version], training_progress: [], training_lessons: [] } });

  it("grades one answer on the server and keeps the FIRST answer to a question", async () => {
    const rec = quizWorld({ [questions[0]!.id]: "a" });
    const out = await answer(rec.client, link, { attemptId: ATTEMPT, questionId: questions[0]!.id, choiceId: "b" });
    expect(out).toMatchObject({ feedback: { right: false, answer: "b" }, result: null });
    expect(rec.writtenRows("training_attempts")[0]).toMatchObject({ answers: { [questions[0]!.id]: "a" } });
  });

  it("submits on the last answer; a fail names the missed chapters and opens the rewatch fresh", async () => {
    const four = Object.fromEntries(questions.slice(0, 4).map((q, i) => [q.id, i < 2 ? "a" : "b"]));
    const rec = quizWorld(four);
    const out = await answer(rec.client, link, { attemptId: ATTEMPT, questionId: questions[4]!.id, choiceId: "b" });
    expect(out).toMatchObject({ result: { correct: 3, total: 5, passed: false, missedChapters: [0, 1] } });
    expect(rec.writtenRows("training_attempts")[0]).toMatchObject({ passed: false, correct: 3, missed_chapters: [0, 1] });
    expect(rec.writtenRows("training_progress")[0]).toEqual({ watched_since: [] });
    expectOrgScoped(rec, ORG);
  });

  it("refuses an answer to a question the quiz did not serve, or to a finished quiz", async () => {
    expect(await answer(quizWorld(null).client, link, { attemptId: ATTEMPT, questionId: questions[5]!.id, choiceId: "b" })).toMatchObject({ status: 422 });
    const done = createSupabaseRecorder({ tables: { training_attempts: [{ ...open({}), submitted_at: "2026-11-24T10:05:00Z" }] } });
    expect(await answer(done.client, link, { attemptId: ATTEMPT, questionId: questions[0]!.id, choiceId: "b" })).toMatchObject({ status: 409 });
  });
});
