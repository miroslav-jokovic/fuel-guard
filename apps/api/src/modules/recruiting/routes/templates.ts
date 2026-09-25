import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { recruitmentTemplatePdf } from "../recruitmentTemplates.js";

/**
 * Blank documents for the office to print (MV2, D-MVR2).
 *
 * Gated on `recruitment: view`, like every PDF the section reads: printing a blank form changes
 * nothing, and a recruiter who can see the applicants is the person who hands the paper over. No
 * audit, for the same reason — a blank carries no applicant, and the act worth recording is the
 * paper signature coming BACK (`POST /authorizations`, which audits).
 */
export function recruitmentTemplatesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/templates/:key.pdf",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recruitmentTemplatePdf(admin, req.auth!.orgId!, String(req.params.key ?? ""));
      if (!result) {
        res.status(404).json(apiError("not_found", "There is no such template."));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.setHeader("cache-control", "no-store, private");
      res.send(result.pdf);
    }),
  );

  return router;
}
