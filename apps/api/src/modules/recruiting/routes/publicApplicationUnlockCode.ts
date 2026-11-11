import { Router } from "express";
import {
  unlockCodeRequestSchema,
  unlockCodeVerifySchema,
  type UnlockCodeRequest,
  type UnlockCodeVerify,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { unlockCodeLimiter, unlockLimiter } from "../../../middleware/applicationLimits.js";
import { isIntakeError } from "../applicationIntake.js";
import { requestUnlockCode, unlockWithCode } from "../applicationUnlockCode.js";

/**
 * The one-time code in place of the date of birth (F0b) — `applicationUnlockCode.ts` says what it may
 * and may not do. Two routes on the applicant's link:
 *
 *   POST /:token/unlock-code         { channel, language }  → sent (masked address) | held (why)
 *   POST /:token/unlock-code/verify  { code }               → the released draft, as /unlock answers
 *
 * The body names a channel, never an address: the code goes where the link went.
 */
const STATUS: Record<string, number> = {
  invalid_link: 404,
  sign_link_locked: 410,
  not_locked: 409,
  code_not_accepted: 422,
  code_failed: 502,
};

export function publicApplicationUnlockCodeRouter(): Router {
  const router = Router();

  router.post(
    "/:token/unlock-code",
    unlockCodeLimiter(),
    validateBody(unlockCodeRequestSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await requestUnlockCode(
        getSupabaseAdmin(env), env, String(req.params.token ?? ""), res.locals.body as UnlockCodeRequest, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(STATUS[result.code] ?? 500).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  router.post(
    "/:token/unlock-code/verify",
    // Its own ten-in-ten-minutes bucket — the date-of-birth unlock's figure and reasoning.
    unlockLimiter(),
    validateBody(unlockCodeVerifySchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await unlockWithCode(
        getSupabaseAdmin(env), String(req.params.token ?? ""), (res.locals.body as UnlockCodeVerify).code, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(STATUS[result.code] ?? 500).json(apiError(result.code, result.message));
        return;
      }
      res.json({ draft: result });
    }),
  );

  return router;
}
