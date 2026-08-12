import { Router } from "express";
import { z } from "zod";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { mintStepUpToken } from "../lib/stepUpToken.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * POST /api/auth/step-up — exchange a freshly-typed password for a short-lived step-up token.
 *
 * The companion to lib/stepUpToken.ts (audit P0-4, see its header for why `iat` was not proof of a
 * password). Flow: the ALREADY-AUTHENTICATED user submits their password; we forward it to
 * Supabase's own password grant for the email on their verified JWT; on success we mint the HMAC
 * token the step-up gates accept. The password exists here only in flight — never logged, never
 * stored, never in an error message.
 *
 * ── Why the password grant and not amr claims ────────────────────────────────────────────────────
 * GoTrue's `amr` claims would let the gate read "password event at time T" off the JWT itself, but
 * their presence and shape depend on the auth server's version and config — a gate resting on a
 * claim that silently disappears fails OPEN. The grant round-trip is one call on a rare action and
 * is true on every Supabase deployment. (If the QA test pass shows stable amr claims, reading them
 * becomes a later optimisation — the token stays the contract either way.)
 *
 * ── Abuse posture ────────────────────────────────────────────────────────────────────────────────
 * This endpoint is a password oracle for the CALLER'S OWN account only (email comes from the
 * verified JWT, never the body). Failures are audited with the actor id; Supabase's own rate
 * limiting applies to the grant; and the mount shares the API's global limiter. A 403 here says
 * "password refused" and nothing else — no distinction an attacker can use.
 */

const stepUpSchema = z.object({ password: z.string().min(1).max(200) });

export function authStepUpRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/step-up", asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const parsed = stepUpSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(apiError("invalid_request", "Password is required."));
      return;
    }
    const { userId, orgId, email } = req.auth!;
    if (!email || !orgId) {
      res.status(400).json(apiError("invalid_request", "This session cannot step up — no email or org on the token."));
      return;
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      res.status(503).json(apiError("step_up_unavailable", "Password verification is not configured on this deploy."));
      return;
    }

    // Supabase's own password grant is the verifier. The response session is DISCARDED — we want
    // the yes/no, not another set of tokens in circulation.
    const grant = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password: parsed.data.password }),
    });

    const admin = getSupabaseAdmin(env);
    if (!grant.ok) {
      await writeAudit(admin, {
        orgId, actorId: userId, action: "auth.step_up_refused", entity: "users", entityId: userId,
        meta: { httpStatus: grant.status },
      });
      res.status(403).json(apiError("step_up_refused", "That password was not accepted."));
      return;
    }

    const minted = mintStepUpToken(env, userId, orgId);
    if (!minted) {
      res.status(503).json(apiError("step_up_unavailable", "Step-up signing is not configured on this deploy."));
      return;
    }
    await writeAudit(admin, {
      orgId, actorId: userId, action: "auth.step_up_verified", entity: "users", entityId: userId,
      meta: { expiresAt: minted.expiresAt },
    });
    res.json(minted);
  }));

  return router;
}
