import { Router } from "express";
import { secondFactorStatus, type SecondFactorStatus } from "@silvicom/shared";
import { requireAuthFirstStep, requireOrg } from "../../../middleware/auth.js";
import { readAccessState, secondFactorFacts, sessionClaim } from "../../../middleware/membershipCurrent.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";

/**
 * `GET /api/me/second-factor` — what two-step sign-in asks of the caller (INSTALLED-APP-PLAN IA-S1).
 *
 * The one route behind `requireAuthFirstStep`: a token that still owes its code is answered here and
 * refused everywhere else, so the app can send the person to the code page instead of showing a wall of
 * failures. It says only what the caller's own sign-in needs — required, satisfied, set up, and for an admin
 * in their 14 days of notice, the date — read fresh, never from the 15-second cache, because the page asks
 * it straight after the person changed the answer.
 *
 * Setting a factor up, entering a code and turning it off are Supabase's own endpoints, called by the
 * browser: this API never sees a secret or a code.
 */
export function secondFactorRouter(): Router {
  const router = Router();
  router.use(requireAuthFirstStep);

  router.get(
    "/",
    requireOrg,
    asyncHandler(async (req, res) => {
      const auth = req.auth!;
      const read = await readAccessState(getSupabaseAdmin(getAppLocals(req).env), { userId: auth.userId, orgId: auth.orgId!, sessionId: sessionClaim(auth) });
      if ("error" in read || !read.row) {
        res.status(503).json(apiError("unavailable", "Could not read your sign-in settings. Try again."));
        return;
      }
      const answer: SecondFactorStatus = secondFactorStatus(secondFactorFacts(read.row), auth.aal, new Date());
      res.json(answer);
    }),
  );

  return router;
}
