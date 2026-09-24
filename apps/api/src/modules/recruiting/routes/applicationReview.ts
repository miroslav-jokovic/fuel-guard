import { Router } from "express";
import {
  applicantIdentitySchema,
  applicationEditSchema,
  type ApplicantIdentity,
  type ApplicationEdit,
} from "@silvicom/shared";
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
import { applicationPermissionsPdf, isPermissionsError } from "../applicationPdf/permissions.js";
import { correctApplicantIdentity, isIdentityCorrectionError } from "../applicantIdentity.js";
import { isApplicationSendError, sendApplication } from "../applicationSend.js";
import { isOpenSigningError, openPacketSigning } from "../applicationOpenSigning.js";

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
      : code === "invalid_edit" || code === "invalid_request"
        ? 400
        : code === "application_not_editable" || code === "application_not_reviewable"
          || code === "already_certified" || code === "already_filed" || code === "nothing_to_preview"
          || code === "nothing_signed_yet" || code === "invitation_revoked"
          || code === "permissions_incomplete" || code === "application_not_approved"
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

  /**
   * What the applicant has signed, as a printable document (B2).
   *
   * ⚠ Invitation-keyed, beside the preview, and NOT driver-keyed like the releases panel it is
   * printed from. Recorded as the step's one real decision rather than settled in passing: the marks,
   * the draft and the consent all key on the live invitation (0227 makes `invitation_id` unique on
   * the consent), so a document spanning two invitations could not be dated — a rehire's older
   * signatures belong to their own application. The panel stays driver-keyed because a recruiter
   * looking at a person wants every release that person ever signed; a printed instrument belongs to
   * one hire.
   *
   * ⚠ `canView`, like the preview above it. Printing what somebody signed changes nothing, and a
   * recruiter who could read the releases on the screen but not on paper would photograph the screen.
   *
   * Streamed, never filed: nothing cites these bytes and nothing hashes them, and the document says
   * so across every page. D-AX8 keeps the filed record single.
   */
  router.get(
    "/applications/:invitationId/permissions.pdf",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicationPermissionsPdf(
        admin,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
      );
      if (isPermissionsError(result)) {
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

  /**
   * Correct the applicant's date of birth and licence (AF3, D-AF8) — the office's half of the one
   * identity writer. It OVERWRITES, on `drivers` and the draft together, so the licence PSP is
   * ordered against and the licence on the application stay one licence.
   *
   * ⚠ `canManage`: this changes the facts a background check is run on. It is not refused on an
   * expired link — the office corrects identity while it screens, and the owner's order waits on
   * labs long enough to outlive one (0365's header).
   */
  router.post(
    "/applications/:invitationId/identity",
    requireOrg,
    canManage,
    validateBody(applicantIdentitySchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await correctApplicantIdentity(
        admin,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
        res.locals.body as ApplicantIdentity,
        req.auth!.userId,
      );
      if (isIdentityCorrectionError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true });
    }),
  );

  /**
   * Send the applicant the application form (AF4, D-AF5, D-AF7).
   *
   * Answers with the new link — the only copy — so the office can hand it over on screen, and with
   * the screening steps still outstanding, which it WARNS about and does not refuse on. A second
   * press rotates the link and re-sends; the first send's date is the one kept.
   */
  router.post(
    "/applications/:invitationId/send-application",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await sendApplication(
        getSupabaseAdmin(env),
        env,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
        req.auth!.userId,
      );
      if (isApplicationSendError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, ...result });
    }),
  );

  /**
   * Open packet signing, in the office (AF5, D-AF3, D-AF6).
   *
   * Answers with the sign link — the only copy — for the office to open on its own screen, and with
   * the federal gates and road test still outstanding, which it WARNS about and does not refuse on.
   * ⚠ It emails nothing: a sign link sent anywhere else would let the packet be signed away from the
   * office, which is what D-AF3 exists to stop. A second press rotates the link; the first date stays.
   */
  router.post(
    "/applications/:invitationId/open-signing",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await openPacketSigning(
        getSupabaseAdmin(env),
        env,
        req.auth!.orgId!,
        String(req.params.invitationId ?? ""),
        req.auth!.userId,
      );
      if (isOpenSigningError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, ...result });
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
