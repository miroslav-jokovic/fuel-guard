import { Router } from "express";
import {
  applicationCaptureConfirmSchema,
  applicationCaptureStartSchema,
  type ApplicationCaptureConfirm,
  type ApplicationCaptureStart,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { confirmCapture, startCapture } from "../applicationCapture.js";
import { isIntakeError } from "../applicationIntake.js";

/**
 * The photograph slots on an application link (A8, D-APP10) — split out of `publicApplication.ts`
 * ahead of C1, which adds a tenth route to a file that stood at 461 of the 500-line budget.
 *
 * Same mount, same paths, same guards: the parent mounts this at its own root, so both routes still
 * answer at `/api/public/application/:token/capture…` exactly as before. Nothing here changed but the
 * file it lives in — the seam is that `captureStatus` had two callers and both are here, so the one
 * helper in that module with a single concern moved with the routes that are its only users.
 */

/**
 * The capture endpoints' shared answer map.
 *
 * `capture_upload_failed` is 422 and not 404: the link is fine, the slot is fine, and the one thing
 * that is wrong — no object at that key — is something the driver fixes by taking the photograph
 * again. A 404 here would read as "your link is dead" to a page whose whole vocabulary for 404 is
 * exactly that.
 */
function captureStatus(code: string): number {
  if (code === "invalid_link") return 404;
  if (code === "already_submitted" || code === "esign_consent_required" || code === "application_not_sent") return 409;
  if (code === "capture_upload_failed") return 422;
  return 500;
}

export function publicApplicationCaptureRouter(): Router {
  const router = Router();

  /**
   * Somewhere to put one photograph (A8, D-APP10).
   *
   * The response is a signed upload URL and an id; nothing is written. The bytes go from the phone
   * straight to Storage — `compliance.ts:110`'s property, and the reason a driver uploading six
   * megabytes on a truck-stop connection does not occupy an API worker for the duration.
   */
  router.post(
    "/:token/capture",
    validateBody(applicationCaptureStartSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await startCapture(
        admin, String(req.params.token ?? ""),
        res.locals.body as ApplicationCaptureStart, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(captureStatus(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json(result);
    }),
  );

  /**
   * The bytes landed — record the slot (A8).
   *
   * PUT, and idempotent per slot: a re-shoot replaces what that slot held rather than adding to it,
   * which is what keeps three attempts at one blurry licence from becoming three rows in a
   * qualification file (D-APP10). The capture id in the path is what the start call minted; the
   * storage key is recomputed from it server-side and never taken from the request.
   */
  router.put(
    "/:token/capture/:captureId",
    validateBody(applicationCaptureConfirmSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await confirmCapture(
        admin, String(req.params.token ?? ""), String(req.params.captureId ?? ""),
        res.locals.body as ApplicationCaptureConfirm, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(captureStatus(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, ...result });
    }),
  );

  return router;
}
