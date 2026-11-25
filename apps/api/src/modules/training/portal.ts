import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acceptableSpanMs,
  addWatched,
  assignmentComplete,
  chapterSpans,
  drawQuiz,
  gradeQuiz,
  type PoolQuestion,
  type TrainingAnswer,
  type TrainingAnswerFeedback,
  type TrainingAnswerResult,
  type TrainingPortalFilm,
  type TrainingPortalHome,
  type TrainingPortalQuiz,
  type TrainingProgress,
} from "@silvicom/shared";
import { hashLinkToken, isLinkToken, signPaths } from "./media.js";
import { refuse, type TrainingRefusal } from "./refusal.js";
import { ASSIGNMENT_COLS, ATTEMPT_COLS, standings, type AssignmentRow, type AttemptRow, type FilmStanding } from "./standing.js";

/**
 * The driver's link page (`/t/:token`, D-TR2): no login — the link is the credential, and it opens only
 * this driver's training. Everything here starts from `resolveLink`, which turns the token into ONE
 * assignment row; every later query is scoped to that row's org and id.
 *
 * ── GRADING IS HERE, NEVER ON THE PAGE (R6) ────────────────────────────────────────────────────
 * The quiz the page receives has no answers. Each answer is posted and graded here, and the reply carries
 * that question's answer and "why" — the driver learns from each answer as they go (the mockup's flow),
 * and the answer to a question is never on the phone before it has been answered.
 */

/** A crypto-backed `Random` for the draw: a driver cannot predict the next quiz from the last one. */
const cryptoRandom = (): number => randomInt(0, 2 ** 32) / 2 ** 32;

const fail = (what: string, e: { message: string }): never => {
  throw new Error(`[training] ${what}: ${e.message}`);
};

export interface Link {
  orgId: string;
  assignment: AssignmentRow;
}

/** The token → its live assignment, or why not. One answer for unknown and cancelled: nothing to learn. */
export async function resolveLink(admin: SupabaseClient, token: string): Promise<Link | TrainingRefusal> {
  const gone = refuse(404, "link_not_found", "This link does not work. Ask the office to send it again.");
  if (!isLinkToken(token)) return gone;
  const { data, error } = await admin.from("training_assignments").select(`org_id, ${ASSIGNMENT_COLS}`).eq("token_hash", hashLinkToken(token)).maybeSingle();
  if (error) fail("link not read", error);
  const row = data as (AssignmentRow & { org_id: string }) | null;
  if (!row || row.revoked_at) return gone;
  if (new Date(row.link_expires_at).getTime() < Date.now()) return refuse(410, "link_expired", "This link has expired. Ask the office to send it again.");
  return { orgId: row.org_id, assignment: row };
}

async function filmsOf(admin: SupabaseClient, link: Link): Promise<FilmStanding[]> {
  return (await standings(admin, link.orgId, [link.assignment])).get(link.assignment.id) ?? [];
}

export async function portalHome(admin: SupabaseClient, link: Link): Promise<TrainingPortalHome> {
  const { orgId, assignment: a } = link;
  if (!a.first_opened_at) {
    const { error } = await admin.from("training_assignments").update({ first_opened_at: new Date().toISOString() }).eq("org_id", orgId).eq("id", a.id).is("first_opened_at", null);
    if (error) fail("first open not kept", error);
  }
  const [films, org, drv, course] = await Promise.all([
    filmsOf(admin, link),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    admin.from("drivers").select("full_name").eq("org_id", orgId).eq("id", a.driver_id).maybeSingle(),
    admin.from("training_courses").select("title").eq("org_id", orgId).eq("id", a.course_id).maybeSingle(),
  ]);
  const posters = await signPaths(admin, films.map((f) => f.version.poster_path));
  return {
    carrier: (org.data as { name: string } | null)?.name ?? "",
    firstName: ((drv.data as { full_name: string | null } | null)?.full_name ?? "").trim().split(/\s+/)[0] ?? "",
    courseTitle: (course.data as { title: string } | null)?.title ?? "",
    dueOn: a.due_on,
    complete: assignmentComplete(films),
    lessons: films.map((f) => ({
      lessonId: f.lessonId,
      versionId: f.version.id,
      title: f.title,
      durationMs: f.version.duration_ms,
      posterUrl: posters.get(f.version.poster_path) ?? "",
      status: f.status,
    })),
  };
}

async function openFilm(admin: SupabaseClient, link: Link, versionId: string): Promise<FilmStanding | TrainingRefusal> {
  const film = (await filmsOf(admin, link)).find((f) => f.version.id === versionId);
  if (!film) return refuse(404, "not_found", "That video is not part of your training.");
  if (film.status === "locked") return refuse(409, "locked", "Finish the video before this one first.");
  return film;
}

export async function portalFilm(admin: SupabaseClient, link: Link, versionId: string): Promise<TrainingPortalFilm | TrainingRefusal> {
  const film = await openFilm(admin, link, versionId);
  if ("refused" in film) return film;
  const v = film.version;
  const paths = [...v.renditions.map((r) => r.path), v.poster_path, ...(v.captions_path ? [v.captions_path] : [])];
  const signed = await signPaths(admin, paths);
  return {
    versionId: v.id,
    title: film.title,
    durationMs: v.duration_ms,
    chapters: v.chapters ?? [],
    renditions: v.renditions
      .map((r) => ({ height: r.height, url: signed.get(r.path) ?? "", bytes: r.bytes }))
      .filter((r) => r.url)
      .sort((x, y) => x.height - y.height),
    posterUrl: signed.get(v.poster_path) ?? "",
    captionsUrl: v.captions_path ? (signed.get(v.captions_path) ?? null) : null,
    positionMs: film.progress?.position_ms ?? 0,
    watched: film.progress?.watched ?? [],
    status: film.status,
    rewatch: film.state.kind === "rewatch" ? film.state.chapters : [],
  };
}

/**
 * One span the page played. Refused when longer than the time since the last report allows (a dragged
 * bar is not watching, R7); `watched_since` grows only while a failed quiz is waiting on a rewatch.
 */
export async function recordProgress(admin: SupabaseClient, link: Link, p: TrainingProgress): Promise<{ status: string } | TrainingRefusal> {
  const film = await openFilm(admin, link, p.versionId);
  if ("refused" in film) return film;
  const dur = film.version.duration_ms;
  const since = film.progress ? Date.now() - new Date(film.progress.updated_at).getTime() : null;
  const span: [number, number] = [Math.min(p.fromMs, p.toMs), Math.max(p.fromMs, p.toMs)];
  const accepted = span[1] - span[0] <= acceptableSpanMs(since);
  const watched = accepted ? addWatched(film.progress?.watched ?? [], span, dur) : (film.progress?.watched ?? []);
  const rewatching = film.state.kind === "rewatch";
  const watchedSince = accepted && rewatching ? addWatched(film.progress?.watched_since ?? [], span, dur) : (film.progress?.watched_since ?? []);
  const row = { watched, watched_since: watchedSince, position_ms: Math.min(Math.max(0, p.positionMs), dur), updated_at: new Date().toISOString() };
  if (film.progress) {
    const { error } = await admin.from("training_progress").update(row).eq("org_id", link.orgId).eq("assignment_id", link.assignment.id).eq("version_id", p.versionId);
    if (error) fail("progress not kept", error);
  } else {
    const { error } = await admin.from("training_progress").insert({ org_id: link.orgId, assignment_id: link.assignment.id, version_id: p.versionId, ...row });
    if (error) fail("progress not kept", error);
  }
  const after = (await openFilm(admin, link, p.versionId)) as FilmStanding;
  return { status: "refused" in after ? "locked" : after.status };
}

async function poolOf(admin: SupabaseClient, orgId: string, versionId: string): Promise<PoolQuestion[]> {
  const { data, error } = await admin.from("training_questions").select("id, chapter, prompt, choices, answer, why").eq("org_id", orgId).eq("version_id", versionId);
  if (error) fail("questions not read", error);
  return (data ?? []) as PoolQuestion[];
}

const feedbackOf = (q: PoolQuestion, choice: string): TrainingAnswerFeedback => ({ right: q.answer === choice, answer: q.answer, why: q.why, chapter: q.chapter });

/** Start the quiz, or return the open one (a driver who lost signal mid-quiz continues where they were). */
export async function startQuiz(admin: SupabaseClient, link: Link, versionId: string): Promise<TrainingPortalQuiz | TrainingRefusal> {
  const film = await openFilm(admin, link, versionId);
  if ("refused" in film) return film;
  const open = film.attempts.find((x) => !x.submitted_at);
  if (!open && film.status !== "quiz") {
    return film.status === "passed"
      ? refuse(409, "passed", "You already passed this video.")
      : refuse(409, "watch_first", film.status === "rewatch" ? "Watch the chapters you missed again first." : "Watch the video first.");
  }
  const pool = await poolOf(admin, link.orgId, versionId);
  let attempt: AttemptRow | undefined = open;
  if (!attempt) {
    const lastServed = new Set(film.attempts.filter((x) => x.submitted_at).slice(-1).flatMap((x) => x.served.map((s) => s.questionId)));
    const served = drawQuiz(pool, film.version.serve_count, cryptoRandom, lastServed);
    const { data, error } = await admin
      .from("training_attempts")
      .insert({ org_id: link.orgId, assignment_id: link.assignment.id, version_id: versionId, served })
      .select(ATTEMPT_COLS)
      .single();
    if (error?.code === "23505") return startQuiz(admin, link, versionId); // a second tap raced the first
    if (error || !data) fail("quiz not started", error ?? { message: "no row" });
    attempt = data as AttemptRow;
  }
  const byId = new Map(pool.map((q) => [q.id, q]));
  const answered: TrainingPortalQuiz["answered"] = {};
  for (const [qid, choice] of Object.entries(attempt.answers ?? {})) {
    const q = byId.get(qid);
    if (q) answered[qid] = feedbackOf(q, choice);
  }
  return {
    attemptId: attempt.id,
    passCount: film.version.pass_count,
    answered,
    questions: attempt.served.flatMap((s) => {
      const q = byId.get(s.questionId);
      if (!q) return [];
      const text = new Map(q.choices.map((c) => [c.id, c.text]));
      return [{ id: q.id, prompt: q.prompt, choices: s.order.map((id) => ({ id, text: text.get(id) ?? "" })) }];
    }),
  };
}

/** One answer: graded here, kept on the open attempt; the last one submits the quiz. */
export async function answer(admin: SupabaseClient, link: Link, a: TrainingAnswer): Promise<TrainingAnswerResult | TrainingRefusal> {
  const { data, error } = await admin
    .from("training_attempts")
    .select(ATTEMPT_COLS)
    .eq("org_id", link.orgId)
    .eq("assignment_id", link.assignment.id)
    .eq("id", a.attemptId)
    .maybeSingle();
  if (error) fail("quiz not read", error);
  const attempt = data as AttemptRow | null;
  if (!attempt) return refuse(404, "not_found", "That quiz is not yours.");
  if (attempt.submitted_at) return refuse(409, "submitted", "This quiz is already finished.");
  if (!attempt.served.some((s) => s.questionId === a.questionId)) return refuse(422, "not_served", "That question is not in this quiz.");
  const pool = await poolOf(admin, link.orgId, attempt.version_id);
  const q = pool.find((x) => x.id === a.questionId);
  if (!q) return refuse(404, "not_found", "That question is gone.");
  const prior = attempt.answers ?? {};
  // The first answer counts: answering again after seeing the right one would grade the reveal, not the driver.
  const choice = prior[a.questionId] ?? a.choiceId;
  const answers = { ...prior, [a.questionId]: choice };
  const done = attempt.served.every((s) => answers[s.questionId]);
  const { data: version } = await admin.from("training_versions").select("pass_count, duration_ms, chapters").eq("org_id", link.orgId).eq("id", attempt.version_id).maybeSingle();
  const v = version as { pass_count: number; duration_ms: number; chapters: Array<{ title: string; startMs: number }> } | null;
  const graded = done ? gradeQuiz(attempt.served, pool, answers, v?.pass_count ?? attempt.served.length) : null;
  const patch: Record<string, unknown> = { answers };
  if (graded) Object.assign(patch, { submitted_at: new Date().toISOString(), correct: graded.correct, passed: graded.passed, missed_chapters: graded.missedChapters });
  const { error: ue } = await admin.from("training_attempts").update(patch).eq("org_id", link.orgId).eq("id", attempt.id).is("submitted_at", null);
  if (ue) fail("answer not kept", ue);
  if (graded && !graded.passed) {
    // D-TR8: a failed quiz starts the rewatch window fresh, so only chapters watched AFTER it count.
    const { error: pe } = await admin.from("training_progress").update({ watched_since: [] }).eq("org_id", link.orgId).eq("assignment_id", link.assignment.id).eq("version_id", attempt.version_id);
    if (pe) fail("rewatch not opened", pe);
  }
  if (graded?.passed) await markCompleteIfDone(admin, link);
  // Chapter indexes are clamped to the film's chapters, so the page never names a chapter that is not there.
  const chapterCount = v ? chapterSpans(v.chapters ?? [], v.duration_ms).length : 1;
  const fb = feedbackOf(q, choice);
  return {
    feedback: { ...fb, chapter: Math.min(fb.chapter, chapterCount - 1) },
    result: graded ? { correct: graded.correct, total: graded.total, passed: graded.passed, missedChapters: graded.missedChapters } : null,
  };
}

async function markCompleteIfDone(admin: SupabaseClient, link: Link): Promise<void> {
  if (link.assignment.completed_at) return;
  if (!assignmentComplete(await filmsOf(admin, link))) return;
  const { error } = await admin.from("training_assignments").update({ completed_at: new Date().toISOString() }).eq("org_id", link.orgId).eq("id", link.assignment.id).is("completed_at", null);
  if (error) fail("completion not kept", error);
}
