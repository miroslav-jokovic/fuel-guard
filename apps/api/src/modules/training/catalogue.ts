import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TrainingChapter,
  TrainingCourseCreate,
  TrainingCourseSummary,
  TrainingCourseUpdate,
  TrainingLessonCreate,
  TrainingLessonUpdate,
  TrainingVersionState,
  TrainingVersionSummary,
} from "@silvicom/shared";
import { signPaths } from "./media.js";
import { refuse, type TrainingRefusal } from "./refusal.js";

/**
 * The office's catalogue (D-TR5): courses, the films in them, and each film's versions — rows, never
 * code, so film 06 and Acts II–IV are added on the page. Every query names the org: the API reads with
 * the service role, which RLS does not bind.
 */

interface CourseRow { id: string; title: string; description: string | null; position: number; retired_at: string | null }
interface LessonRow { id: string; course_id: string; title: string; position: number; retired_at: string | null }
export interface VersionRow {
  id: string;
  lesson_id: string;
  version_no: number;
  language: "en" | "es";
  state: TrainingVersionState;
  duration_ms: number | null;
  chapters: TrainingChapter[];
  serve_count: number;
  pass_count: number;
  process_error: string | null;
  poster_path: string | null;
  published_at: string | null;
}
export const VERSION_COLS = "id, lesson_id, version_no, language, state, duration_ms, chapters, serve_count, pass_count, process_error, poster_path, published_at";

const fail = (what: string, e: { message: string }): never => {
  throw new Error(`[training] ${what}: ${e.message}`);
};

/** Every course with its films and their versions, newest version first; posters signed for the list. */
export async function listCatalogue(admin: SupabaseClient, orgId: string): Promise<TrainingCourseSummary[]> {
  const [c, l, v, q] = await Promise.all([
    admin.from("training_courses").select("id, title, description, position, retired_at").eq("org_id", orgId).order("position").order("created_at"),
    admin.from("training_lessons").select("id, course_id, title, position, retired_at").eq("org_id", orgId).order("position").order("created_at"),
    admin.from("training_versions").select(VERSION_COLS).eq("org_id", orgId).order("version_no", { ascending: false }),
    admin.from("training_questions").select("version_id").eq("org_id", orgId),
  ]);
  for (const [r, what] of [[c, "courses"], [l, "films"], [v, "versions"], [q, "questions"]] as const) if (r.error) fail(`${what} not read`, r.error);
  const versions = (v.data ?? []) as VersionRow[];
  const counts = new Map<string, number>();
  for (const r of (q.data ?? []) as Array<{ version_id: string }>) counts.set(r.version_id, (counts.get(r.version_id) ?? 0) + 1);
  const posters = await signPaths(admin, versions.map((x) => x.poster_path).filter((p): p is string => !!p), 3600);
  const lessons = (l.data ?? []) as LessonRow[];
  return ((c.data ?? []) as CourseRow[]).map((course) => ({
    id: course.id,
    title: course.title,
    description: course.description,
    position: course.position,
    retiredAt: course.retired_at,
    lessons: lessons
      .filter((x) => x.course_id === course.id)
      .map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        retiredAt: lesson.retired_at,
        versions: versions.filter((x) => x.lesson_id === lesson.id).map((x) => versionSummary(x, counts.get(x.id) ?? 0, posters)),
      })),
  }));
}

export function versionSummary(v: VersionRow, questionCount: number, posters: Map<string, string>): TrainingVersionSummary {
  return {
    id: v.id,
    versionNo: v.version_no,
    language: v.language,
    state: v.state,
    durationMs: v.duration_ms,
    chapters: v.chapters ?? [],
    serveCount: v.serve_count,
    passCount: v.pass_count,
    questionCount,
    processError: v.process_error,
    posterUrl: v.poster_path ? (posters.get(v.poster_path) ?? null) : null,
    publishedAt: v.published_at,
  };
}

export async function createCourse(admin: SupabaseClient, orgId: string, userId: string, body: TrainingCourseCreate): Promise<{ id: string }> {
  const { count } = await admin.from("training_courses").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { data, error } = await admin
    .from("training_courses")
    .insert({ org_id: orgId, title: body.title, description: body.description, position: count ?? 0, created_by: userId })
    .select("id")
    .single();
  if (error || !data) fail("course not created", error ?? { message: "no row" });
  return { id: (data as { id: string }).id };
}

export async function updateCourse(admin: SupabaseClient, orgId: string, id: string, body: TrainingCourseUpdate): Promise<true | TrainingRefusal> {
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.position !== undefined) patch.position = body.position;
  if (body.retire) patch.retired_at = new Date().toISOString();
  const { data, error } = await admin.from("training_courses").update(patch).eq("org_id", orgId).eq("id", id).select("id");
  if (error) fail("course not changed", error);
  return (data ?? []).length ? true : refuse(404, "not_found", "No such course.");
}

export async function createLesson(admin: SupabaseClient, orgId: string, userId: string, body: TrainingLessonCreate): Promise<{ id: string } | TrainingRefusal> {
  const { data: course, error: ce } = await admin.from("training_courses").select("id").eq("org_id", orgId).eq("id", body.courseId).maybeSingle();
  if (ce) fail("course not read", ce);
  if (!course) return refuse(404, "not_found", "No such course.");
  const { count } = await admin.from("training_lessons").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("course_id", body.courseId);
  const { data, error } = await admin
    .from("training_lessons")
    .insert({ org_id: orgId, course_id: body.courseId, title: body.title, position: count ?? 0, created_by: userId })
    .select("id")
    .single();
  if (error || !data) fail("film not created", error ?? { message: "no row" });
  return { id: (data as { id: string }).id };
}

export async function updateLesson(admin: SupabaseClient, orgId: string, id: string, body: TrainingLessonUpdate): Promise<true | TrainingRefusal> {
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.position !== undefined) patch.position = body.position;
  if (body.retire) patch.retired_at = new Date().toISOString();
  const { data, error } = await admin.from("training_lessons").update(patch).eq("org_id", orgId).eq("id", id).select("id");
  if (error) fail("film not changed", error);
  return (data ?? []).length ? true : refuse(404, "not_found", "No such film.");
}
