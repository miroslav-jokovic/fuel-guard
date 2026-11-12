import { Router } from "express";
import { applicantSsnSchema, FULL_SSN_PERMISSION, type ApplicantSsn } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { requireNamedPermission } from "../../org/index.js";
import { isOfficeSsnError, replaceApplicantSsn, revealApplicantSsn } from "../applicantSsn.js";
import { fullSsnApplicationPdf, isFullSsnCopyError } from "../applicationPdf/fullSsnCopy.js";

/**
 * The office's two acts on an applicant's SSN before signing (Q-AM17, owner 2026-11-11; 0589).
 *
 *   POST /applications/:invitationId/ssn   { ssn }  → replace it   (recruitment: manage)
 *   GET  /applications/:invitationId/ssn            → all nine     (recruitment: view + "See the full SSN")
 *   GET  /filed-applications/:documentId/full-ssn.pdf → the filed packet with all nine (same gate; Q-AM20)
 *
 * Replacing is every corrector's; READING the whole number is the named permission's, shipped to the
 * safety manager and always the admin's. Everyone else sees the last four the review already carries.
 * Its own module so `applicationReview.ts` keeps its budget.
 */
export function recruitmentApplicationSsnRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const status = (code: string): number =>
    code === "application_not_found" ? 404 : code === "ssn_not_saved" || code === "edit_not_recorded" ? 500 : 409;

  router.post(
    "/applications/:invitationId/ssn",
    requireOrg,
    requireSection("recruitment"),
    validateBody(applicantSsnSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await replaceApplicantSsn(
        getSupabaseAdmin(env), env, req.auth!.orgId!, String(req.params.invitationId ?? ""),
        (res.locals.body as ApplicantSsn).ssn, req.auth!.userId,
      );
      if (isOfficeSsnError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json(result);
    }),
  );

  router.get(
    "/applications/:invitationId/ssn",
    requireOrg,
    requireSection("recruitment", "view"),
    requireNamedPermission(FULL_SSN_PERMISSION),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await revealApplicantSsn(
        getSupabaseAdmin(env), env, req.auth!.orgId!, String(req.params.invitationId ?? ""), req.auth!.userId,
      );
      if (isOfficeSsnError(result)) {
        res.status(status(result.code)).json(apiError(result.code, result.message));
        return;
      }
      // Never cached: nine digits must not sit in a browser or proxy cache.
      res.set("Cache-Control", "no-store").json(result);
    }),
  );
  /**
   * The filed packet with the SSN in full (Q-AM20 (a)), by the stored document the office opened — the
   * driver's filing or its countersigned copy. Drawn on demand over those bytes, never stored, audited.
   */
  router.get(
    "/filed-applications/:documentId/full-ssn.pdf",
    requireOrg,
    requireSection("recruitment", "view"),
    requireNamedPermission(FULL_SSN_PERMISSION),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await fullSsnApplicationPdf(
        getSupabaseAdmin(env), env, req.auth!.orgId!, String(req.params.documentId ?? ""), req.auth!.userId,
      );
      if (isFullSsnCopyError(result)) {
        const code = result.code === "document_not_found" ? 404 : result.code === "storage_failed" ? 500 : 409;
        res.status(code).json(apiError(result.code, result.message));
        return;
      }
      res.set("Cache-Control", "no-store");
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", 'inline; filename="application-full-ssn.pdf"');
      res.send(result);
    }),
  );
  return router;
}
