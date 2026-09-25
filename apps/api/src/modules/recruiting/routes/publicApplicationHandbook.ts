import { Router } from "express";
import { handbookMarkSchema, type HandbookMark } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isIntakeError } from "../applicationIntake.js";
import { applicantHandbookPdf, recordHandbookMark } from "../handbookCeremony.js";

/**
 * The driver handbook on the applicant's own link (HANDBOOK-SIGNING-PLAN.md HB3; D-HB1).
 *
 * Its own module because `publicApplication.ts` stands near its 500-line budget and these two routes
 * are one surface: read the handbook, sign a place. Mounted at the parent's root, so the paths are
 * `/api/public/application/:token/handbook.pdf` and `…/handbook/mark`. Both are on the ceremony's
 * per-link bucket (`applicationLimits.ts`), for the packet's reason.
 */
export function publicApplicationHandbookRouter(): Router {
  const router = Router();

  /**
   * The handbook as the driver signs it. ⚠ Bytes, for `/:token/packet`'s reason while it is being
   * signed: rendered on demand with the places signed so far, stored only when the office files it.
   * Once filed, the FILED copy. `409` for "not yet" (not filed, not opened), like every phase refusal.
   */
  router.get(
    "/:token/handbook.pdf",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantHandbookPdf(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(result)) {
        res.status(result.code === "invalid_link" ? 404 : 409).json(apiError(result.code, result.message));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.setHeader("cache-control", "no-store, private");
      res.send(result.pdf);
    }),
  );

  /** One of the driver's five places. Every refusal but a dead link is a 409: the answer is "not now". */
  router.post(
    "/:token/handbook/mark",
    validateBody(handbookMarkSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordHandbookMark(
        admin, String(req.params.token ?? ""), res.locals.body as HandbookMark,
        // `publicApplication.ts`'s `context()`: `trust proxy` is set in app.ts, so this is the
        // applicant's address — the ESIGN attribution 0215 records beside every signature.
        { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null }, new Date(),
      );
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" ? 404 : result.code === "handbook_mark_failed" ? 500 : 409;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, handbook: result });
    }),
  );

  return router;
}
