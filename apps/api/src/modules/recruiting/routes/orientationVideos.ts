import { Router } from "express";
import {
  orientationVideoCreateSchema,
  orientationVideoUpdateSchema,
  type OrientationVideoCreate,
  type OrientationVideoUpdate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  createOrientationVideo,
  isOrientationVideoError,
  listOrientationVideos,
  updateOrientationVideo,
} from "../orientationVideos.js";
import { applicantOrientationVideos, sendOrientationVideos } from "../orientationVideosApplicant.js";

/**
 * The orientation videos, the office's side (HW8a, 0538; HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8).
 *
 * The carrier's list lives in Settings → Recruiting beside the link lifetime and the examiners, behind
 * the same doors (`settings.ts`): `recruitment` view reads, `recruitment` manage writes. The applicant's
 * videos and "Send the videos" sit on the applicant's checklist row behind the section's usual split
 * (`notes.ts`, `dispositions.ts`).
 *
 * Every act writes an audit row. The send's own row is `resendOnInvitation`'s
 * (`compliance.orientation_videos_sent`), written with the rotation it records — never the token.
 */
export function recruitmentOrientationVideosRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  router.get(
    "/orientation-videos",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ videos: await listOrientationVideos(admin, req.auth!.orgId!) });
    }),
  );

  router.post(
    "/orientation-videos",
    requireOrg,
    canManage,
    validateBody(orientationVideoCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const video = await createOrientationVideo(admin, orgId, req.auth!.userId, res.locals.body as OrientationVideoCreate);
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.orientation_video_added",
        entity: "orientation_videos", entityId: video.id, meta: { title: video.title, required: video.required },
      });
      res.status(201).json({ video });
    }),
  );

  router.patch(
    "/orientation-videos/:videoId",
    requireOrg,
    canManage,
    validateBody(orientationVideoUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const patch = res.locals.body as OrientationVideoUpdate;
      const video = await updateOrientationVideo(admin, orgId, req.auth!.userId, String(req.params.videoId ?? ""), patch);
      if (isOrientationVideoError(video)) {
        res.status(video.status).json(apiError(video.code, video.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId,
        action: patch.retire ? "recruitment.orientation_video_retired" : "recruitment.orientation_video_changed",
        entity: "orientation_videos", entityId: video.id, meta: { changes: patch },
      });
      res.json({ video });
    }),
  );

  router.get(
    "/applicants/:driverId/orientation-videos",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const view = await applicantOrientationVideos(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isOrientationVideoError(view)) {
        res.status(view.status).json(apiError(view.code, view.message));
        return;
      }
      res.json(view);
    }),
  );

  router.post(
    "/applicants/:driverId/orientation-videos/send",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const sent = await sendOrientationVideos(
        admin, env, req.auth!.orgId!, String(req.params.driverId ?? ""), req.auth!.userId, new Date(),
      );
      if (isOrientationVideoError(sent)) {
        res.status(sent.status).json(apiError(sent.code, sent.message));
        return;
      }
      res.json(sent);
    }),
  );

  return router;
}
