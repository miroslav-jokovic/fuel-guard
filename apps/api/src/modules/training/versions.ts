import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkChapters,
  checkQuestion,
  CHOICE_IDS,
  publishBlockers,
  type TrainingQuestionInput,
  type TrainingQuestionView,
  type TrainingUploadStart,
  type TrainingVersionUpdate,
} from "@silvicom/shared";
import { signPaths, sourcePath, TRAINING_BUCKET } from "./media.js";
import { refuse, refusalFromDb, type TrainingRefusal } from "./refusal.js";

/**
 * A film's versions and their quizzes (§8.3). An upload is a new version: the browser sends the bytes
 * straight to Storage on a signed URL (they never pass through this server), then confirms, and the
 * `training_transcode` job makes the phone versions. Chapters, the quiz rule and the questions change
 * only until the version is published; 0648's triggers hold that even if this file forgets.
 */

const EDITABLE: ReadonlySet<string> = new Set(["draft", "processing", "failed", "ready"]);

const fail = (what: string, e: { message: string }): never => {
  throw new Error(`[training] ${what}: ${e.message}`);
};

interface Editable { id: string; lesson_id: string; state: string; duration_ms: number | null; chapters: Array<{ title: string; startMs: number }>; serve_count: number; pass_count: number }

async function editable(admin: SupabaseClient, orgId: string, versionId: string): Promise<Editable | TrainingRefusal> {
  const { data, error } = await admin
    .from("training_versions")
    .select("id, lesson_id, state, duration_ms, chapters, serve_count, pass_count")
    .eq("org_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) fail("version not read", error);
  if (!data) return refuse(404, "not_found", "No such video.");
  const v = data as Editable;
  if (!EDITABLE.has(v.state)) return refuse(409, "published", "This video is published, so it cannot change. Upload a new version instead.");
  return v;
}

/** Step 1: a new version row and a signed URL the browser uploads the film to. */
export async function startUpload(admin: SupabaseClient, orgId: string, userId: string, body: TrainingUploadStart): Promise<{ versionId: string; uploadUrl: string } | TrainingRefusal> {
  const { data: lesson, error: le } = await admin.from("training_lessons").select("id").eq("org_id", orgId).eq("id", body.lessonId).maybeSingle();
  if (le) fail("film not read", le);
  if (!lesson) return refuse(404, "not_found", "No such film.");
  const { data: last, error: ve } = await admin
    .from("training_versions")
    .select("version_no")
    .eq("org_id", orgId)
    .eq("lesson_id", body.lessonId)
    .order("version_no", { ascending: false })
    .limit(1);
  if (ve) fail("versions not read", ve);
  const versionNo = (((last ?? [])[0] as { version_no: number } | undefined)?.version_no ?? 0) + 1;
  const { data: row, error } = await admin
    .from("training_versions")
    .insert({ org_id: orgId, lesson_id: body.lessonId, version_no: versionNo, language: body.language, source_bytes: body.bytes, source_sha256: body.sha256, created_by: userId })
    .select("id")
    .single();
  if (error || !row) fail("version not created", error ?? { message: "no row" });
  const versionId = (row as { id: string }).id;
  const path = sourcePath(orgId, body.lessonId, versionId);
  const { data: signed, error: se } = await admin.storage.from(TRAINING_BUCKET).createSignedUploadUrl(path);
  if (se || !signed) fail("upload URL", se ?? { message: "no URL" });
  const { error: pe } = await admin.from("training_versions").update({ source_path: path }).eq("org_id", orgId).eq("id", versionId);
  if (pe) fail("upload path not kept", pe);
  return { versionId, uploadUrl: (signed as { signedUrl: string }).signedUrl };
}

/** Step 2: the bytes arrived; mark the version `processing`. The caller queues the transcode. */
export async function confirmUpload(admin: SupabaseClient, orgId: string, versionId: string): Promise<true | TrainingRefusal> {
  const v = await editable(admin, orgId, versionId);
  if ("refused" in v) return v;
  if (v.state === "ready") return refuse(409, "already_ready", "This video is already prepared.");
  const { error } = await admin.from("training_versions").update({ state: "processing", process_error: null }).eq("org_id", orgId).eq("id", versionId);
  if (error) fail("version not queued", error);
  return true;
}

export async function updateVersion(admin: SupabaseClient, orgId: string, versionId: string, body: TrainingVersionUpdate): Promise<true | TrainingRefusal> {
  const v = await editable(admin, orgId, versionId);
  if ("refused" in v) return v;
  const patch: Record<string, unknown> = {};
  if (body.chapters !== undefined) {
    if (v.duration_ms == null) return refuse(409, "not_ready", "Chapters are marked once the video is prepared, so its length is known.");
    const wrong = checkChapters(body.chapters, v.duration_ms);
    if (wrong) return refuse(422, "chapters", wrong);
    patch.chapters = body.chapters;
  }
  const serve = body.serveCount ?? v.serve_count;
  const pass = body.passCount ?? v.pass_count;
  if (pass > serve) return refuse(422, "quiz_rule", "A driver cannot need more right answers than questions asked.");
  if (body.serveCount !== undefined) patch.serve_count = serve;
  if (body.passCount !== undefined) patch.pass_count = pass;
  const { error } = await admin.from("training_versions").update(patch).eq("org_id", orgId).eq("id", versionId);
  return refusalFromDb(error) ?? (error ? fail("version not changed", error) : true);
}

/** Publish; withdraws the film's live cut in the same transaction (`training_publish_version`, 0648). */
export async function publishVersion(admin: SupabaseClient, orgId: string, versionId: string, userId: string): Promise<{ withdrew: string | null } | TrainingRefusal> {
  // Every stop must be answerable before drivers see it (`publishBlockers`, D-TR14/D-TR15): 3 points per
  // segment, two versions of each. The database checks only that the video is ready, so the bank is
  // checked here; once published, 0648's triggers freeze it.
  const [v, q] = await Promise.all([
    admin.from("training_versions").select("state, chapters").eq("org_id", orgId).eq("id", versionId).maybeSingle(),
    admin.from("training_questions").select("chapter, point").eq("org_id", orgId).eq("version_id", versionId),
  ]);
  if (v.error) fail("version not read", v.error);
  if (q.error) fail("questions not read", q.error);
  if (!v.data) return refuse(404, "not_found", "No such video.");
  const row = v.data as { state: string; chapters: Array<{ title: string; startMs: number }> | null };
  const blockers = publishBlockers({ state: row.state, chapters: row.chapters ?? [], questions: (q.data ?? []) as Array<{ chapter: number; point: number }> });
  if (blockers.length) return refuse(409, "not_publishable", blockers.join(" "));
  const { data, error } = await admin.rpc("training_publish_version", { p_org: orgId, p_version: versionId, p_actor: userId });
  const r = refusalFromDb(error);
  if (r) return r;
  if (error) fail("not published", error);
  return { withdrew: (data as string | null) ?? null };
}

export async function withdrawVersion(admin: SupabaseClient, orgId: string, versionId: string, userId: string): Promise<true | TrainingRefusal> {
  const { data, error } = await admin
    .from("training_versions")
    .update({ state: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_by: userId })
    .eq("org_id", orgId)
    .eq("id", versionId)
    .eq("state", "published")
    .select("id");
  if (error) fail("not withdrawn", error);
  return (data ?? []).length ? true : refuse(409, "not_published", "Only a published video can be withdrawn.");
}

/**
 * A short-lived link to a version's smallest rendition, for the office to watch while it marks
 * chapters and writes questions (Safety → Training, §8.3). The smallest because the office only needs
 * to see where a chapter starts, and it is the quickest to load. Refused until the worker has made the
 * renditions; a withdrawn version may still be watched, since records name it.
 */
export async function previewVersion(admin: SupabaseClient, orgId: string, versionId: string): Promise<{ url: string; durationMs: number } | TrainingRefusal> {
  const { data, error } = await admin.from("training_versions").select("id, renditions, duration_ms").eq("org_id", orgId).eq("id", versionId).maybeSingle();
  if (error) fail("version not read", error);
  if (!data) return refuse(404, "not_found", "No such video.");
  const v = data as { renditions: Array<{ height: number; path: string }> | null; duration_ms: number | null };
  const smallest = [...(v.renditions ?? [])].sort((a, b) => a.height - b.height)[0];
  if (!smallest || !v.duration_ms) return refuse(409, "not_ready", "This video is still being prepared for phones.");
  const url = (await signPaths(admin, [smallest.path], 3600)).get(smallest.path);
  if (!url) return fail("preview not signed", { message: smallest.path });
  return { url, durationMs: v.duration_ms };
}

// ── questions ──────────────────────────────────────────────────────────────────────────────────

interface QuestionRow { id: string; chapter: number; point: number; prompt: string; choices: Array<{ id: string; text: string }>; answer: string; why: string; position: number }

export async function listQuestions(admin: SupabaseClient, orgId: string, versionId: string): Promise<TrainingQuestionView[]> {
  const { data, error } = await admin
    .from("training_questions")
    .select("id, chapter, point, prompt, choices, answer, why, position")
    .eq("org_id", orgId)
    .eq("version_id", versionId)
    .order("position")
    .order("created_at");
  if (error) fail("questions not read", error);
  return ((data ?? []) as QuestionRow[]).map((q) => ({
    id: q.id,
    chapter: q.chapter,
    point: q.point,
    prompt: q.prompt,
    choices: q.choices.map((c) => c.text),
    answerIndex: Math.max(0, q.choices.findIndex((c) => c.id === q.answer)),
    why: q.why,
    position: q.position,
  }));
}

/** The stored shape: choices get ids a–e in the order written; the answer is the id at answerIndex. */
const stored = (q: TrainingQuestionInput) => ({
  chapter: q.chapter,
  point: q.point,
  prompt: q.prompt,
  choices: q.choices.map((text, i) => ({ id: CHOICE_IDS[i], text })),
  answer: CHOICE_IDS[q.answerIndex],
  why: q.why,
});

export async function saveQuestion(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  versionId: string,
  questionId: string | null,
  q: TrainingQuestionInput,
): Promise<{ id: string } | TrainingRefusal> {
  const v = await editable(admin, orgId, versionId);
  if ("refused" in v) return v;
  const wrong = checkQuestion(q, (v.chapters ?? []).length);
  if (wrong) return refuse(422, "question", wrong);
  if (questionId) {
    const { data, error } = await admin.from("training_questions").update(stored(q)).eq("org_id", orgId).eq("version_id", versionId).eq("id", questionId).select("id");
    const r = refusalFromDb(error);
    if (r) return r;
    if (error) fail("question not changed", error);
    return (data ?? []).length ? { id: questionId } : refuse(404, "not_found", "No such question.");
  }
  const { count } = await admin.from("training_questions").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("version_id", versionId);
  const { data, error } = await admin
    .from("training_questions")
    .insert({ org_id: orgId, version_id: versionId, ...stored(q), position: count ?? 0, created_by: userId })
    .select("id")
    .single();
  const r = refusalFromDb(error);
  if (r) return r;
  if (error || !data) fail("question not added", error ?? { message: "no row" });
  return { id: (data as { id: string }).id };
}

export async function deleteQuestion(admin: SupabaseClient, orgId: string, versionId: string, questionId: string): Promise<true | TrainingRefusal> {
  const v = await editable(admin, orgId, versionId);
  if ("refused" in v) return v;
  const { data, error } = await admin.from("training_questions").delete().eq("org_id", orgId).eq("version_id", versionId).eq("id", questionId).select("id");
  const r = refusalFromDb(error);
  if (r) return r;
  if (error) fail("question not removed", error);
  return (data ?? []).length ? true : refuse(404, "not_found", "No such question.");
}
