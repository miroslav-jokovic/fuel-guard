import { Router } from "express";
import { applicantSsnSchema, FULL_SSN_PERMISSION, type ApplicantSsn } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { requireNamedPermission } from "../../org/index.js";
import { isOfficeSsnError, replaceApplicantSsn, revealApplicantSsn } from "../applicantSsn.js";

/**
 * The office's two acts on an applicant's SSN before signing (Q-AM17, owner 2026-11-11; 0589).
 *
 *   POST /applications/:invitationId/ssn   { ssn }  → replace it   (recruitment: manage)
 *   GET  /applications/:invitationId/ssn            → all nine     (recruitment: view + "See the full SSN")
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
  return router;
}
