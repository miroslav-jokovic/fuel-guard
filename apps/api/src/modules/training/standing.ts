import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignedLessons,
  filmState,
  lessonStatuses,
  type FilmState,
  type LessonStatus,
  type PointResult,
  type TrainingChapter,
  type WatchedRanges,
} from "@silvicom/shared";

/** Every answer of a cut's submitted attempts, as the segment rules read them. */
export function pointResults(attempts: readonly AttemptRow[], bank: readonly BankRow[]): PointResult[] {
  const byId = new Map(bank.map((q) => [q.id, q]));
  return attempts
    .filter((x) => x.submitted_at)
    .flatMap((x) =>
      x.served.flatMap((s) => {
        const q = byId.get(s.questionId);
        return q ? [{ chapter: q.chapter, point: q.point, right: x.answers?.[s.questionId] === q.answer }] : [];
      }),
    );
}

/**
 * Where one driver stands on one assignment: each film's published cut, what they watched of it, the
 * questions they answered at each stop, and so each film's status (SEGMENT-QUIZ D-TR13–D-TR15). One read
 * path for the driver's page and the office's Progress tab, so the two can never disagree about whether
 * a driver passed.
 *
 * The cut a driver is measured against is the film's CURRENT published version in English (v1, Q-TR6):
 * a remaster published after a driver passed does not un-pass them — their pass on the cut they watched
 * stands (`passedOn`), and the office sees which cut that was.
 */

export interface AssignmentRow {
  id: string;
  /** Null for a phone-number recipient (0663); then `recipient_name` and `recipient_phone` are set. */
  driver_id: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  course_id: string;
  lesson_ids: string[] | null;
  due_on: string | null;
  link_expires_at: string;
  last_sent_at: string | null;
  last_sent_via: "sms" | "email" | "copy" | null;
  first_opened_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export const ASSIGNMENT_COLS = "id, driver_id, recipient_name, recipient_phone, course_id, lesson_ids, due_on, link_expires_at, last_sent_at, last_sent_via, first_opened_at, completed_at, revoked_at, created_at";

export interface FilmVersion {
  id: string;
  lesson_id: string;
  version_no: number;
  duration_ms: number;
  chapters: TrainingChapter[];
  renditions: Array<{ height: number; path: string; bytes: number }>;
  poster_path: string;
  captions_path: string | null;
  serve_count: number;
  pass_count: number;
}
const FILM_COLS = "id, lesson_id, version_no, duration_ms, chapters, renditions, poster_path, captions_path, serve_count, pass_count";

export interface AttemptRow {
  id: string;
  assignment_id: string;
  version_id: string;
  served: Array<{ questionId: string; order: string[] }>;
  answers: Record<string, string> | null;
  /** When each answer reached the server (0650); null on a quiz from before it. */
  answered_at: Record<string, string> | null;
  correct: number | null;
  passed: boolean | null;
  missed_chapters: number[] | null;
  started_at: string;
  submitted_at: string | null;
}
export const ATTEMPT_COLS = "id, assignment_id, version_id, served, answers, answered_at, correct, passed, missed_chapters, started_at, submitted_at";

/** A question as the standing needs it: where it belongs and its answer (server-side only). */
export interface BankRow { id: string; version_id: string; chapter: number; point: number; answer: string }

export interface ProgressRow { assignment_id: string; version_id: string; watched: WatchedRanges; watched_since: WatchedRanges; position_ms: number; updated_at: string }

export interface FilmStanding {
  lessonId: string;
  title: string;
  version: FilmVersion;
  progress: ProgressRow | null;
  attempts: AttemptRow[];
  /** The current cut's questions, with their answers — never sent to the page as such. */
  bank: BankRow[];
  state: FilmState;
  status: LessonStatus;
}

const fail = (what: string, e: { message: string }): never => {
  throw new Error(`[training] ${what}: ${e.message}`);
};

/** Standing for many assignments of one org at once (the Progress tab), or one (the driver's page). */
export async function standings(admin: SupabaseClient, orgId: string, assignments: readonly AssignmentRow[]): Promise<Map<string, FilmStanding[]>> {
  const out = new Map<string, FilmStanding[]>();
  if (assignments.length === 0) return out;
  const courseIds = [...new Set(assignments.map((a) => a.course_id))];
  const ids = assignments.map((a) => a.id);
  const { data: lessons, error: le } = await admin
    .from("training_lessons")
    .select("id, course_id, title, position, retired_at")
    .eq("org_id", orgId)
    .in("course_id", courseIds)
    .order("position")
    .order("created_at");
  if (le) fail("films not read", le);
  const lessonRows = (lessons ?? []) as Array<{ id: string; course_id: string; title: string; retired_at: string | null }>;
  const [v, p, t] = await Promise.all([
    admin.from("training_versions").select(FILM_COLS).eq("org_id", orgId).eq("state", "published").eq("language", "en").in("lesson_id", lessonRows.map((l) => l.id)),
    admin.from("training_progress").select("assignment_id, version_id, watched, watched_since, position_ms, updated_at").eq("org_id", orgId).in("assignment_id", ids),
    admin.from("training_attempts").select(ATTEMPT_COLS).eq("org_id", orgId).in("assignment_id", ids).order("started_at"),
  ]);
  for (const [r, what] of [[v, "published films"], [p, "progress"], [t, "quizzes"]] as const) if (r.error) fail(`${what} not read`, r.error);
  const versions = new Map(((v.data ?? []) as FilmVersion[]).map((x) => [x.lesson_id, x]));
  const progress = (p.data ?? []) as ProgressRow[];
  const attempts = (t.data ?? []) as AttemptRow[];
  // Every cut a quiz was taken on, and its questions: a film passed on an older cut (before a remaster)
  // stays passed, so each cut's standing is worked out from its own chapters and questions.
  const attemptedIds = [...new Set(attempts.map((x) => x.version_id))];
  const cuts = new Map(((v.data ?? []) as FilmVersion[]).map((x) => [x.id, x]));
  const older = attemptedIds.filter((id) => !cuts.has(id));
  if (older.length) {
    const { data, error } = await admin.from("training_versions").select(FILM_COLS).eq("org_id", orgId).in("id", older);
    if (error) fail("quizzed films not read", error);
    for (const x of (data ?? []) as FilmVersion[]) cuts.set(x.id, x);
  }
  const bankIds = [...cuts.keys()];
  const bank: BankRow[] = [];
  if (bankIds.length) {
    const { data, error } = await admin.from("training_questions").select("id, version_id, chapter, point, answer").eq("org_id", orgId).in("version_id", bankIds);
    if (error) fail("questions not read", error);
    bank.push(...((data ?? []) as BankRow[]));
  }
  const stateOn = (cut: FilmVersion, a: string): FilmState => {
    const prog = progress.find((x) => x.assignment_id === a && x.version_id === cut.id);
    const onCut = attempts.filter((x) => x.assignment_id === a && x.version_id === cut.id);
    const qs = bank.filter((q) => q.version_id === cut.id);
    return filmState({
      durationMs: cut.duration_ms,
      chapters: cut.chapters ?? [],
      questions: qs,
      watched: prog?.watched ?? [],
      watchedSince: prog?.watched_since ?? [],
      results: pointResults(onCut, qs),
    });
  };

  for (const a of assignments) {
    // A retired film stays in an assignment that named it, and leaves a whole-course one.
    const inCourse = lessonRows.filter((l) => l.course_id === a.course_id && (a.lesson_ids ? true : !l.retired_at));
    const films: FilmStanding[] = [];
    for (const lesson of assignedLessons(inCourse, a.lesson_ids)) {
      const version = versions.get(lesson.id);
      if (!version) continue;
      const mine = attempts.filter((x) => x.assignment_id === a.id);
      const olderPass = [...new Set(mine.map((x) => x.version_id))]
        .map((id) => cuts.get(id))
        .some((cut) => !!cut && cut.id !== version.id && cut.lesson_id === lesson.id && stateOn(cut, a.id).kind === "passed");
      const prog = progress.find((x) => x.assignment_id === a.id && x.version_id === version.id) ?? null;
      const state: FilmState = olderPass ? { kind: "passed" } : stateOn(version, a.id);
      films.push({
        lessonId: lesson.id,
        title: lesson.title,
        version,
        progress: prog,
        attempts: mine.filter((x) => x.version_id === version.id),
        bank: bank.filter((q) => q.version_id === version.id),
        state,
        status: "locked",
      });
    }
    const statuses = lessonStatuses(films.map((f) => ({ lessonId: f.lessonId, film: f.state })));
    films.forEach((f, i) => (f.status = statuses[i]?.status ?? "locked"));
    out.set(a.id, films);
  }
  return out;
}
