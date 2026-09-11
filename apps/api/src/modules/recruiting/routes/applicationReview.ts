import { Router } from "express";
import { applicationEditSchema, type ApplicationEdit } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import {
  applicationForReview,
  approveApplication,
  editApplication,
  isReviewError,
} from "../applicationReview.js";

/**
 * Reading, correcting and approving an applicant's answers (F4).
 *
 * ── WHY THE WRITES NEED `manage` AND THE READ DOES NOT ────────────────────────────────────────
 * Changing another person's answer to a federally-required question, and then telling them to certify
 * it, is a management act — it is the one thing in this flow a recruiter does ON somebody rather than
 * FOR them. Reading takes `view`, as the rest of the recruitment section does, so anybody who can see
 * an applicant can see what was filled in and what has been changed.
 *
 * ── AND WHY THE EDIT WINDOW IS THE SERVICE'S AND NOT THE ROUTE'S ──────────────────────────────
 * `applicationIsEditable` lives beside the state machine it reads, so the screen, the route and the
 * driver's own page cannot disagree about when an answer may still move. A route that re-derived it
 * from the same three timestamps would be the second opinion that eventually drifts.
 */
export function recruitmentApplicationReviewRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireSection("recruitment", "view");
  const canManage = requireSection("recruitment");

  const status = (code: string): number =>
    code === "application_not_found"
      ? 404
      : code === "invalid_edit"
        ? 400
        : code === "application_not_editable" || code === "application_not_reviewable" || code === "already_certified"
          ? 409
          : 500;

  /** The answers, where it has got to, and every correction made to it. */
  router.get(
    "/applications/:invitationId/review",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicationForReview(
        admin,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
      );
      if (isReviewError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /** Correct one answer. The whole document is re-parsed before anything is written. */
  router.patch(
    "/applications/:invitationId/answer",
    requireOrg,
    canManage,
    validateBody(applicationEditSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await editApplication(
        admin,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
        res.locals.body as ApplicationEdit,
        { actorId: req.auth!.userId },
      );
      if (isReviewError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /** Approve it and hand it back to the driver to certify. */
  router.post(
    "/applications/:invitationId/approve",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await approveApplication(
        admin,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
        { actorId: req.auth!.userId },
        new Date(),
      );
      if (isReviewError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
