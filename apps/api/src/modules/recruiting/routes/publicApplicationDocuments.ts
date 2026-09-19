import { Router } from "express";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { applicantCopy } from "../applicationCopy.js";
import { isIntakeError } from "../applicationIntake.js";

/**
 * What an application link will hand back as a DOCUMENT — split out of `publicApplication.ts` ahead
 * of C1, which adds a route to a file that stood at 461 of the 500-line budget.
 *
 * Same mount, same paths: the parent mounts this at its own root, so `GET /:token/document` still
 * answers at `/api/public/application/:token/document` exactly as before. Nothing here changed but
 * the file it lives in.
 *
 * ⚠ The seam is deliberately *documents*, and not "the leftovers". C1's gap is that the nine routes
 * on this link serve JSON and storage URLs and **none of them serves the packet the driver is about
 * to sign** — so the next route to arrive is a second document, answering the same question at a
 * different moment in the application's life. Putting the one that exists in a file named for the
 * question means the second one has somewhere obvious to go, and means the two are read together:
 * they differ on whether the application has been filed, and that is the only thing they differ on.
 */
export function publicApplicationDocumentsRouter(): Router {
  const router = Router();

  /**
   * The applicant's own copy of what was filed (X8, D-AX9).
   *
   * ⚠ A GET that returns a URL rather than the bytes, which is this product's idiom for every other
   * evidence document (`compliance.ts`). The bytes go from Storage to the driver's phone and never
   * through this API — one fewer place for a PDF of somebody's employment history to be logged,
   * buffered or cached.
   *
   * `not_submitted` is a 409 and not a 404: the link is perfectly valid and the answer is "not yet",
   * which is a different sentence and a different thing for the page to do about it.
   */
  router.get(
    "/:token/document",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantCopy(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" ? 404 : result.code === "not_submitted" ? 409 : 503;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
