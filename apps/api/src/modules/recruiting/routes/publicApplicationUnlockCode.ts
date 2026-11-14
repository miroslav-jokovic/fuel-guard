import { Router } from "express";
import {
  unlockCodeRequestSchema,
  unlockCodeVerifySchema,
  unlockDeviceSchema,
  type UnlockCodeRequest,
  type UnlockCodeVerify,
  type UnlockDevice,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { unlockCodeLimiter, unlockLimiter } from "../../../middleware/applicationLimits.js";
import { isIntakeError } from "../applicationIntake.js";
import { requestUnlockCode, unlockWithCode } from "../applicationUnlockCode.js";
import { unlockWithDevice } from "../applicationDraft.js";

/**
 * The one-time code in place of the date of birth (F0b) — `applicationUnlockCode.ts` says what it may
 * and may not do. Two routes on the applicant's link:
 *
 *   POST /:token/unlock-code         { channel, language }  → sent (masked address) | held (why)
 *   POST /:token/unlock-code/verify  { code }               → the released draft, as /unlock answers
 *   POST /:token/unlock-device       { device_token }       → the released draft (U2, 0604)
 *
 * The body names a channel, never an address: the code goes where the link went. The third route is
 * the other alternative to typing the date: the token a right answer left on this device
 * (`applicationTrustedDevice.ts`).
 */
const STATUS: Record<string, number> = {
  invalid_link: 404,
  sign_link_locked: 410,
  not_locked: 409,
  code_not_accepted: 422,
  code_failed: 502,
  device_not_known: 422,
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
      const body = res.locals.body as UnlockCodeVerify;
      const result = await unlockWithCode(
        getSupabaseAdmin(env), String(req.params.token ?? ""), body.code, new Date(), body.remember_device === true,
      );
      if (isIntakeError(result)) {
        res.status(STATUS[result.code] ?? 500).json(apiError(result.code, result.message));
        return;
      }
      res.json({ draft: result });
    }),
  );

  router.post(
    "/:token/unlock-device",
    // The unlock's own bucket: trying tokens is bounded with trying dates and codes, per link.
    unlockLimiter(),
    validateBody(unlockDeviceSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await unlockWithDevice(
        getSupabaseAdmin(env), String(req.params.token ?? ""), (res.locals.body as UnlockDevice).device_token, new Date(),
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
