import { Router } from "express";
import { orientationVideoAttestSchema, type OrientationVideoAttest } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isIntakeError } from "../applicationIntake.js";
import { applicantVideoPage, attestVideos, recordVideoOpened } from "../orientationVideosApplicant.js";

/**
 * The applicant's orientation videos page (HW8a, 0538) — `/apply/<token>/videos` on the web.
 *
 * Under `/api/public/application`, so the intake's per-address budget covers it like every other read
 * and write on the link (`applicationLimits.ts`). A dead link is the surface's one neutral 404
 * (`invalid_link`); a list that changed under the page is a 409 the page answers with a reload.
 */
export function publicApplicationVideosRouter(): Router {
  const router = Router();

  router.get(
    "/:token/videos",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const page = await applicantVideoPage(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(page)) {
        res.status(404).json(apiError(page.code, page.message));
        return;
      }
      res.json(page);
    }),
  );

  router.post(
    "/:token/videos/:videoId/opened",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordVideoOpened(admin, String(req.params.token ?? ""), String(req.params.videoId ?? ""), new Date());
      if (isIntakeError(result)) {
        res.status(result.code === "invalid_link" ? 404 : 409).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  router.post(
    "/:token/videos/attest",
    validateBody(orientationVideoAttestSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await attestVideos(
        admin, String(req.params.token ?? ""), res.locals.body as OrientationVideoAttest,
        { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null }, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(result.code === "invalid_link" ? 404 : 409).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json(result);
    }),
  );

  return router;
}
