import { Router, type Request, type Response } from "express";
import { recordId, trainingAnswerSchema, trainingProgressSchema } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { answer, portalFilm, portalHome, recordProgress, resolveLink, startQuiz, type Link } from "../portal.js";
import { isRefusal, type TrainingRefusal } from "../refusal.js";

/**
 * `/api/public/training/:token` — the driver's link page (D-TR2). PUBLIC by design: the token is the
 * credential (144 random bits, stored only as a hash) and opens one driver's training, nothing more.
 * Mounted under app.ts's own rate limit. Answers carry `Cache-Control: no-store`: a signed URL or a
 * driver's progress has no business in a shared cache at a truck stop.
 */

const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
const send = (res: Response, r: TrainingRefusal) => res.status(r.status).json(apiError(r.code, r.message));

async function link(req: Request, res: Response): Promise<Link | null> {
  res.setHeader("Cache-Control", "no-store");
  const out = await resolveLink(adminOf(req), String(req.params.token ?? ""));
  if (isRefusal(out)) {
    send(res, out);
    return null;
  }
  return out;
}

export function publicTrainingRouter(): Router {
  const router = Router();
  const versionId = recordId();

  router.get("/:token", asyncHandler(async (req, res) => {
    const l = await link(req, res);
    if (l) res.json({ ok: true, ...(await portalHome(adminOf(req), l)) });
  }));

  router.get("/:token/films/:versionId", asyncHandler(async (req, res) => {
    const l = await link(req, res);
    if (!l) return;
    const v = versionId.safeParse(req.params.versionId);
    if (!v.success) return void res.status(400).json(apiError("bad_request", "That is not a video of yours."));
    const out = await portalFilm(adminOf(req), l, v.data);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true, ...out });
  }));

  router.post("/:token/progress", validateBody(trainingProgressSchema), asyncHandler(async (req, res) => {
    const l = await link(req, res);
    if (!l) return;
    const out = await recordProgress(adminOf(req), l, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true, ...out });
  }));

  router.post("/:token/films/:versionId/quiz", asyncHandler(async (req, res) => {
    const l = await link(req, res);
    if (!l) return;
    const v = versionId.safeParse(req.params.versionId);
    if (!v.success) return void res.status(400).json(apiError("bad_request", "That is not a video of yours."));
    const out = await startQuiz(adminOf(req), l, v.data);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true, ...out });
  }));

  router.post("/:token/answers", validateBody(trainingAnswerSchema), asyncHandler(async (req, res) => {
    const l = await link(req, res);
    if (!l) return;
    const out = await answer(adminOf(req), l, res.locals.body);
    if (isRefusal(out)) return void send(res, out);
    res.json({ ok: true, ...out });
  }));

  return router;
}
