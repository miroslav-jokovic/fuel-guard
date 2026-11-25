import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  recordId,
  trainingAssignSchema,
  trainingCourseCreateSchema,
  trainingCourseUpdateSchema,
  trainingLessonCreateSchema,
  trainingLessonUpdateSchema,
  trainingQuestionSchema,
  trainingUploadStartSchema,
  trainingVersionUpdateSchema,
  type TrainingAssign,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { enqueueJob } from "../../../queue/enqueue.js";
import { drainKindNow } from "../../../queue/inprocessDrain.js";
import { assign, progressRows, reachOf, resend, revoke, type TrainingTexter } from "../assignments.js";
import { createCourse, createLesson, listCatalogue, updateCourse, updateLesson } from "../catalogue.js";
import { isRefusal, type TrainingRefusal } from "../refusal.js";
import { confirmUpload, deleteQuestion, listQuestions, previewVersion, publishVersion, saveQuestion, startUpload, updateVersion, withdrawVersion } from "../versions.js";

/**
 * `/api/training` — Safety → Training, the office's side (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9).
 *
 * Gated on the `training` module (the carrier bought it) and the `safety` section: reading is
 * `safety: view`, everything that changes what drivers see or sends them something is `safety: manage`
 * (admin, fleet manager, safety manager). Every change is audited; the driver's own acts are the
 * attempt rows themselves.
 */

const idSchema = recordId();
const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
const envOf = (req: Request) => getAppLocals(req).env;
const org = (req: Request) => req.auth!.orgId!;
const user = (req: Request) => req.auth!.userId;

function ids(req: Request, res: Response, ...names: string[]): string[] | null {
  const out: string[] = [];
  for (const n of names) {
    const p = idSchema.safeParse(req.params[n]);
    if (!p.success) {
      res.status(400).json(apiError("bad_request", "That link does not name a training record."));
      return null;
    }
    out.push(p.data);
  }
  return out;
}

const send = (res: Response, r: TrainingRefusal) => res.status(r.status).json(apiError(r.code, r.message));
const audit = (req: Request, action: string, entity: string, entityId: string, meta: Record<string, unknown> = {}) =>
  writeAudit(adminOf(req), { orgId: org(req), actorId: user(req), action: `training.${action}`, entity, entityId, meta });

const reachSchema = z.object({ driverIds: z.array(recordId()).min(1).max(200) });

export function trainingRouter(deps: { texter: TrainingTexter }): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("training"));
  const view = requireSection("safety", "view");
  const manage = requireSection("safety");

  router.get("/catalogue", view, asyncHandler(async (req, res) => {
    res.json({ ok: true, courses: await listCatalogue(adminOf(req), org(req)) });
  }));

  router.post("/courses", manage, validateBody(trainingCourseCreateSchema), asyncHandler(async (req, res) => {
    const out = await createCourse(adminOf(req), org(req), user(req), res.locals.body);
    await audit(req, "course_created", "training_courses", out.id, { title: res.locals.body.title });
    res.status(201).json({ ok: true, ...out });
  }));

  router.patch("/courses/:id", manage, validateBody(trainingCourseUpdateSchema), asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await updateCourse(adminOf(req), org(req), p[0]!, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "course_changed", "training_courses", p[0]!, res.locals.body);
    res.json({ ok: true });
  }));

  router.post("/lessons", manage, validateBody(trainingLessonCreateSchema), asyncHandler(async (req, res) => {
    const out = await createLesson(adminOf(req), org(req), user(req), res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "film_created", "training_lessons", out.id, { title: res.locals.body.title });
    res.status(201).json({ ok: true, ...out });
  }));

  router.patch("/lessons/:id", manage, validateBody(trainingLessonUpdateSchema), asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await updateLesson(adminOf(req), org(req), p[0]!, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "film_changed", "training_lessons", p[0]!, res.locals.body);
    res.json({ ok: true });
  }));

  // ── a film's versions ──────────────────────────────────────────────────────────────────────
  router.post("/uploads", manage, validateBody(trainingUploadStartSchema), asyncHandler(async (req, res) => {
    const out = await startUpload(adminOf(req), org(req), user(req), res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    res.status(201).json({ ok: true, ...out });
  }));

  router.post("/versions/:id/uploaded", manage, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const admin = adminOf(req);
    const out = await confirmUpload(admin, org(req), p[0]!);
    if (isRefusal(out)) return void send(res, out);
    await enqueueJob(admin, "training_transcode", { orgId: org(req), payload: { versionId: p[0] }, dedupKey: `training_transcode:${p[0]}`, requestedBy: user(req) });
    // Start it now rather than at the next drain tick; never awaited, so the office's click returns at once.
    void drainKindNow(envOf(req), admin, "training_transcode", 1);
    await audit(req, "video_uploaded", "training_versions", p[0]!);
    res.json({ ok: true });
  }));

  router.patch("/versions/:id", manage, validateBody(trainingVersionUpdateSchema), asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await updateVersion(adminOf(req), org(req), p[0]!, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true });
  }));

  router.post("/versions/:id/publish", manage, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await publishVersion(adminOf(req), org(req), p[0]!, user(req));
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "video_published", "training_versions", p[0]!, { withdrew: out.withdrew });
    res.json({ ok: true, ...out });
  }));

  router.post("/versions/:id/withdraw", manage, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await withdrawVersion(adminOf(req), org(req), p[0]!, user(req));
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "video_withdrawn", "training_versions", p[0]!);
    res.json({ ok: true });
  }));

  router.get("/versions/:id/preview", view, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await previewVersion(adminOf(req), org(req), p[0]!);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true, ...out });
  }));

  router.get("/versions/:id/questions", view, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    res.json({ ok: true, questions: await listQuestions(adminOf(req), org(req), p[0]!) });
  }));

  router.post("/versions/:id/questions", manage, validateBody(trainingQuestionSchema), asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await saveQuestion(adminOf(req), org(req), user(req), p[0]!, null, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    res.status(201).json({ ok: true, ...out });
  }));

  router.put("/versions/:id/questions/:qid", manage, validateBody(trainingQuestionSchema), asyncHandler(async (req, res) => {
    const p = ids(req, res, "id", "qid");
    if (!p) return;
    const out = await saveQuestion(adminOf(req), org(req), user(req), p[0]!, p[1]!, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true, ...out });
  }));

  router.delete("/versions/:id/questions/:qid", manage, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id", "qid");
    if (!p) return;
    const out = await deleteQuestion(adminOf(req), org(req), p[0]!, p[1]!);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true });
  }));

  // ── sending and progress ───────────────────────────────────────────────────────────────────
  router.post("/reach", view, validateBody(reachSchema), asyncHandler(async (req, res) => {
    res.json({ ok: true, reach: await reachOf(adminOf(req), envOf(req), deps.texter, org(req), res.locals.body.driverIds) });
  }));

  router.post("/assignments", manage, validateBody(trainingAssignSchema), asyncHandler(async (req, res) => {
    const body = res.locals.body as TrainingAssign;
    const out = await assign(adminOf(req), envOf(req), deps.texter, org(req), user(req), body);
    if (isRefusal(out)) return void send(res, out);
    for (const o of out) await audit(req, "sent", "training_assignments", o.assignmentId, { driverId: o.driverId, courseId: body.courseId, lessons: body.lessonIds, via: o.via });
    res.status(201).json({ ok: true, sent: out });
  }));

  router.get("/assignments", view, asyncHandler(async (req, res) => {
    res.json({ ok: true, assignments: await progressRows(adminOf(req), org(req)) });
  }));

  router.post("/assignments/:id/resend", manage, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await resend(adminOf(req), envOf(req), deps.texter, org(req), p[0]!);
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "resent", "training_assignments", p[0]!, { via: out.via });
    res.json({ ok: true, sent: out });
  }));

  router.post("/assignments/:id/revoke", manage, asyncHandler(async (req, res) => {
    const p = ids(req, res, "id");
    if (!p) return;
    const out = await revoke(adminOf(req), org(req), user(req), p[0]!);
    if (isRefusal(out)) return void send(res, out);
    await audit(req, "link_cancelled", "training_assignments", p[0]!);
    res.json({ ok: true });
  }));

  return router;
}
