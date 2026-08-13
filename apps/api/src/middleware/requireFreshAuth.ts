import type { Request, Response, NextFunction } from "express";
import { getAppLocals } from "../lib/appLocals.js";
import { apiError } from "../lib/http.js";
import { STEP_UP_TOKEN_HEADER, verifyStepUpToken } from "../lib/stepUpToken.js";

/**
 * Step-up re-authentication (plan §6.3): prove it is still the same person, right now.
 *
 * ── What it actually checks ──────────────────────────────────────────────────────────────────────
 * The step-up token is minted only after Supabase accepts a fresh password grant. It is HMAC-bound to
 * the verified user and org, so a refreshed access token cannot silently become a step-up proof.
 * There is no table, no second credential store, and nothing the browser can forge — the token is
 * verified against the deploy's signing key.
 *
 * ── Where it is required, and where it deliberately is not ───────────────────────────────────────
 * Required for: the write-entitlement probe, enabling card control, granting or revoking approvers,
 * an override above CARD_OVERRIDE_STEP_UP_ABOVE_USES uses, and any prompts change that removes the
 * driver-ID record.
 *
 * NOT required for a plain lock or unlock. That is the safety action you want frictionless at 2am
 * when a truck has been broken into, and it is fully reversible. A control that makes the emergency
 * response slower has a cost measured in stolen fuel, and it buys nothing an attacker could not get
 * by waiting five minutes anyway.
 *
 * ── The route contract ────────────────────────────────────────────────────────────────────────────
 * A caller without a valid step-up token is refused, even when the access token has a recent `iat`.
 * Access-token freshness is not password proof because a refresh-token grant can mint a new access
 * token without asking the user to re-enter a password.
 *
 * ── Rejected alternatives ────────────────────────────────────────────────────────────────────────
 * A `step_up_tokens` table: more state, same guarantee. TOTP/WebAuthn: building MFA infrastructure
 * this repo does not have, for one feature — worth doing org-wide one day, not as a side effect of
 * card control.
 */

/** Default freshness window. Long enough to type a password and read a confirmation, short enough
 *  that an unattended laptop is not a standing grant. */
export const DEFAULT_STEP_UP_MAX_AGE_SEC = 300;

export const STEP_UP_CODE = "step_up_required";

/**
 * The response a client needs in order to recover: the code it switches on and the window it must
 * beat. `maxAgeSec` is echoed so the prompt can say "in the last 5 minutes" without hardcoding a
 * number the server owns.
 */
/**
 * The step-up TOKEN is the primary proof (audit P0-4): minted by POST /api/auth/step-up only after
 * Supabase's own password grant accepted the caller's password, HMAC-bound to userId+orgId, expiring
 * in minutes. The web client sends it on every request, so there is no access-token freshness fallback.
 */
function hasStepUpToken(req: Request): boolean {
  const token = req.header(STEP_UP_TOKEN_HEADER);
  const userId = req.auth?.userId;
  const orgId = req.auth?.orgId;
  if (!token || !userId || !orgId) return false;
  return verifyStepUpToken(getAppLocals(req).env, token, userId, orgId);
}

export function requireFreshAuth(maxAgeSec: number = DEFAULT_STEP_UP_MAX_AGE_SEC) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hasStepUpToken(req)) {
      res.status(403).json({
        ...apiError(
          STEP_UP_CODE,
          "Confirm your password to continue. This action needs a recent sign-in.",
        ),
        maxAgeSec,
      });
      return;
    }
    next();
  };
}

/**
 * The same rule as a predicate, for handlers that need step-up only on SOME requests — an override
 * above three uses, a prompts change that drops the driver ID. Those cannot be decided by middleware
 * because the answer is in the parsed body.
 */
export function hasFreshAuth(req: Request): boolean {
  return hasStepUpToken(req);
}

/** The body a conditional step-up refusal sends, so the two paths cannot drift apart. */
export function stepUpRequired(res: Response, maxAgeSec: number, why: string): void {
  res.status(403).json({
    ...apiError(STEP_UP_CODE, why),
    maxAgeSec,
  });
}
