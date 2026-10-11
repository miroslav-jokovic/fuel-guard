import { Router } from "express";
import { USER_ROLES, applicantPurgeSchema, canPurgeApplicant, type ApplicantPurge } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { purgeApplicant } from "../applicantPurge.js";

/**
 * POST /api/recruitment/applicants/:driverId/purge — an admin deletes an applicant outright (Q-AW40).
 *
 * Three gates in front of an act nothing can undo, each for its own reason:
 *  · `canPurgeApplicant` — admin only, the owner's ruling, derived rather than hand-listed so the
 *    route and the board's button read one predicate. 0380 checks it again in SQL.
 *  · `requireFreshAuth` — the password again, on memberPasswordReset.ts's reasoning: a stolen admin
 *    session should not be able to erase a person without it.
 *  · the typed name, in the body — the admin says WHICH person, and the service checks it.
 * Everything about the applicant themselves (archived, never hired, nothing outside the
 * application) is `applicantPurge.ts` and 0380.
 */
export function recruitmentPurgeRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/applicants/:driverId/purge",
    requireOrg,
    requireRole(...USER_ROLES.filter(canPurgeApplicant)),
    requireFreshAuth(),
    validateBody(applicantPurgeSchema),
    asyncHandler(async (req, res) => {
      const outcome = await purgeApplicant(getSupabaseAdmin(getAppLocals(req).env), {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        driverId: String(req.params.driverId ?? ""),
        confirmName: (req.body as ApplicantPurge).confirm_name,
      });
      if (!outcome.ok) {
        res.status(outcome.status).json(apiError(outcome.code, outcome.message));
        return;
      }
      res.json(outcome.result);
    }),
  );

  return router;
}
