import { Router } from "express";
import { applicantSsnSchema, type ApplicantSsn } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isIntakeError } from "../applicationIntake.js";
import { recordApplicantSsn } from "../applicantSsn.js";

/**
 * The applicant's SSN, entered in the form (Q-AM3, 0589; `applicantSsn.ts`). Mounted at the public
 * application router's root, behind the same per-link bucket as every other write on the link.
 * Answers with the last four, which the applicant just typed, and nothing else.
 */
export function publicApplicationSsnRouter(): Router {
  const router = Router();
  router.post(
    "/:token/ssn",
    validateBody(applicantSsnSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const body = res.locals.body as ApplicantSsn;
      const result = await recordApplicantSsn(admin, env, String(req.params.token ?? ""), body.ssn, new Date());
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" ? 404 : result.code === "ssn_not_saved" ? 500 : 409;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, last4: result.last4 });
    }),
  );
  return router;
}
