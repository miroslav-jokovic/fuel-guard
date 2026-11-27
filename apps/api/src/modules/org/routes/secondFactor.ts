import { Router, type Request } from "express";
import { DEVICE_KEY_HEADER, secondFactorStatus, twoStepVerifyBodySchema, type SecondFactorStatus } from "@silvicom/shared";
import { requireAuthFirstStep, requireOrg } from "../../../middleware/auth.js";
import { deviceKeyClaim, forgetMembership, readAccessState, sessionClaim } from "../../../middleware/membershipCurrent.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isTwoStepRefusal, sendTwoStepCode, verifyTwoStepCode, type TwoStepWho } from "../twoStep.js";

/**
 * `/api/me/second-factor` — two-step sign-in by an emailed code (INSTALLED-APP-PLAN IA-S1 rev 2, Q-IA20).
 *
 *   GET  /        what the second step asks of the caller on THIS device: required, satisfied, where the code
 *                 goes (masked), until when this device is trusted
 *   POST /code    email a code to the caller's sign-in address (or say one went out moments ago)
 *   POST /verify  enter it; the right one trusts this device for TWO_STEP_DAYS
 *
 * The three routes behind `requireAuthFirstStep`: a token whose device still owes its code is answered here and
 * refused everywhere else — the app could not otherwise ask for the code it needs. Everything about the person is
 * the TOKEN's: user, company, session, and the email the code goes to (the sign-in address in the token, never
 * one in the request), so nobody can have a code sent anywhere but their own inbox. The device is the app's key
 * header, as 0620 reads it.
 *
 * The status is read fresh, never from requireAuth's 15-second cache, because the page asks straight after a
 * code was entered.
 */
export function secondFactorRouter(): Router {
  const router = Router();
  router.use(requireAuthFirstStep);

  const who = (req: Request): TwoStepWho => ({
    orgId: req.auth!.orgId!,
    userId: req.auth!.userId,
    sessionId: sessionClaim(req.auth!),
    deviceKey: deviceKeyClaim(req.get(DEVICE_KEY_HEADER)),
  });

  router.get(
    "/",
    requireOrg,
    asyncHandler(async (req, res) => {
      const w = who(req);
      const read = await readAccessState(getSupabaseAdmin(getAppLocals(req).env), { ...w, role: req.auth!.role ?? null });
      if ("error" in read || !read.row) {
        res.status(503).json(apiError("unavailable", "Could not read your sign-in settings. Try again."));
        return;
      }
      const answer: SecondFactorStatus = secondFactorStatus(
        { role: read.row.role, twoStepAt: read.row.two_step_at ?? null },
        req.auth!.email ?? null,
        new Date(),
      );
      res.json(answer);
    }),
  );

  router.post(
    "/code",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const out = await sendTwoStepCode(getSupabaseAdmin(env), env, { who: who(req), email: req.auth!.email ?? null });
      if (isTwoStepRefusal(out)) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.json(out);
    }),
  );

  router.post(
    "/verify",
    requireOrg,
    validateBody(twoStepVerifyBodySchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const out = await verifyTwoStepCode(getSupabaseAdmin(env), env, { who: who(req), code: (res.locals.body as { code: string }).code });
      if (isTwoStepRefusal(out)) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      // This process's cached refusals are never cached; its "current" answers for the person are dropped so the
      // very next request reads the new week.
      forgetMembership(req.auth!.userId);
      res.json({ ok: true });
    }),
  );

  return router;
}
