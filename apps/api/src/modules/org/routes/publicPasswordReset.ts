import { Router } from "express";
import {
  passwordResetLookupSchema,
  passwordResetRedeemSchema,
  passwordResetRequestSchema,
  type PasswordResetLookupRequest,
  type PasswordResetRedeemRequest,
  type PasswordResetRequest,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isResetError, redeemReset, requestSelfServiceReset, resolveReset } from "../passwordReset.js";

/**
 * "Forgot password?" — unauthenticated by necessity, because the person cannot sign in.
 *
 * Three verbs, the invitation's two (`publicInvites.ts`) plus the one that starts it:
 *
 *  · `request` ANSWERS BEFORE IT LOOKS. The reply — 202 and one sentence — is sent before the address
 *    is even looked up, and the work runs after. So nothing about the answer, including how long it
 *    took, says whether the address has an account, is a driver's, is over its hourly budget, or
 *    whether mail went out. Timing was the leak `auth.ts` pads with a 350 ms floor; answering first
 *    removes it rather than padding it.
 *  · `lookup` READS. It names the address the link sets a password for, and says a dead link is dead
 *    before anybody types. A mail scanner that renders the page and lets it run has spent nothing.
 *  · `redeem` SPENDS, and only with a password — the one thing a scanner does not have.
 *
 * Tokens travel in POST bodies, never in a path, so they do not land in access logs. The prefix has
 * its own limiter in app.ts; the per-person budget lives in the table (`MAX_RESETS_PER_HOUR`).
 */

/** Work started by `request` after its answer went out. Tests drain it; production never waits. */
const inFlight = new Set<Promise<void>>();

/** Test hook: resolve once every background issuance has finished. */
export async function __drainPasswordResetWork(): Promise<void> {
  await Promise.all([...inFlight]);
}

export function publicPasswordResetRouter(): Router {
  const router = Router();

  router.post(
    "/request",
    validateBody(passwordResetRequestSchema),
    (req, res) => {
      const env = getAppLocals(req).env;
      const { email } = res.locals.body as PasswordResetRequest;
      res.status(202).json({
        ok: true,
        message: "If that address belongs to an account, a reset link is on its way.",
      });
      const work = requestSelfServiceReset(getSupabaseAdmin(env), env, {
        email,
        now: new Date(),
        ip: req.ip ?? "unknown",
      })
        .catch((e: unknown) => console.error(`[password-reset] request failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => inFlight.delete(work));
      inFlight.add(work);
    },
  );

  router.post(
    "/lookup",
    validateBody(passwordResetLookupSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { token } = res.locals.body as PasswordResetLookupRequest;
      const found = await resolveReset(admin, token, new Date());
      if (isResetError(found)) {
        res.status(found.status).json(apiError(found.code, found.message));
        return;
      }
      res.json({ email: found.email, expiresAt: found.expiresAt });
    }),
  );

  router.post(
    "/redeem",
    validateBody(passwordResetRedeemSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const { token, password } = res.locals.body as PasswordResetRedeemRequest;
      const done = await redeemReset(getSupabaseAdmin(env), env, { token, password, now: new Date() });
      if (isResetError(done)) {
        res.status(done.status).json(apiError(done.code, done.message));
        return;
      }
      // The page signs in with the password just set. Every session that existed before this
      // moment has been ended (D-PWR6); the one the page is about to open is the first new one.
      res.json({ ok: true, email: done.email });
    }),
  );

  return router;
}
