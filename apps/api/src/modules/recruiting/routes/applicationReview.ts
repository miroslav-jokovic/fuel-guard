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
import { applicationPreviewPdf, isPreviewError } from "../applicationPdf/preview.js";

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
        : code === "application_not_editable" || code === "application_not_reviewable"
          || code === "already_certified" || code === "already_filed" || code === "nothing_to_preview"
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

  /**
   * The application as a printable document, at any stage before it is filed (F6).
   *
   * ⚠ `canView`, like the review read above it and NOT `canManage`. Printing an application changes
   * nothing about it; anybody who may read the answers on the screen may read them on paper, and a
   * recruiter who can open the drawer and not the PDF would simply photograph the screen.
   *
   * The bytes are streamed rather than filed. A preview is not evidence — nothing cites it, nothing
   * hashes it, and it is superseded the moment the driver types another character — so storing one
   * would put a document in `documents` that says DRAFT and outlives the draft it came from.
   */
  router.get(
    "/applications/:invitationId/preview.pdf",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicationPreviewPdf(
        admin,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
      );
      if (isPreviewError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.send(result.pdf);
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
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      // ⚠ `env` because approval is also what TELLS the applicant (Q-AX4). The notice is reported in
      // this response and never raised — see `notifyApplicationApproved` for why a refused send must
      // not undo an approval.
      const result = await approveApplication(
        admin,
        env,
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
