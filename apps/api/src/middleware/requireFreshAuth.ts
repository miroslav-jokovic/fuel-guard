import type { Request, Response, NextFunction } from "express";
import { apiError } from "../lib/http.js";

/**
 * Step-up re-authentication (plan §6.3): prove it is still the same person, right now.
 *
 * ── What it actually checks ──────────────────────────────────────────────────────────────────────
 * The `iat` of the JWT `requireAuth` has already verified through the project JWKS. A Supabase access
 * token is short-lived and is re-minted by `signInWithPassword`, so "this token was issued in the
 * last five minutes" means the caller typed their password in the last five minutes. That is the
 * whole mechanism: no table, no round trip, no second credential store, and nothing the browser can
 * forge — the number is inside a signature we check.
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
 * ── The caveat that has to be written down ───────────────────────────────────────────────────────
 * An SSO-only org has no password to re-enter. There, `iat` freshness degrades to "your session
 * started recently" rather than "you proved it was you", because that is all the identity provider
 * gives us without building federated re-auth. Every surface that requires step-up is therefore ALSO
 * behind `requireRole("admin")` or an approver scope, so the degraded case is still not open to the
 * whole org. Documented rather than silently weaker.
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
export function requireFreshAuth(maxAgeSec: number = DEFAULT_STEP_UP_MAX_AGE_SEC) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const issuedAt = req.auth?.issuedAt;
    const nowSec = Math.floor(Date.now() / 1000);

    // FAIL CLOSED on a missing claim. A token without `iat` is either older than this feature or not
    // one we minted the way we think; either way we cannot prove freshness, and a step-up gate that
    // waves through what it cannot verify is decoration. See AuthContext.issuedAt.
    //
    // A token issued in the FUTURE is also refused rather than treated as maximally fresh: small
    // clock skew is normal and harmless within the window, but a large negative age means something
    // is wrong with the clock or the token, and neither is a reason to lower a security bar.
    const ageSec = typeof issuedAt === "number" ? nowSec - issuedAt : null;
    if (ageSec === null || ageSec > maxAgeSec || ageSec < -60) {
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
export function hasFreshAuth(req: Request, maxAgeSec: number = DEFAULT_STEP_UP_MAX_AGE_SEC): boolean {
  const issuedAt = req.auth?.issuedAt;
  if (typeof issuedAt !== "number") return false;
  const ageSec = Math.floor(Date.now() / 1000) - issuedAt;
  return ageSec <= maxAgeSec && ageSec >= -60;
}

/** The body a conditional step-up refusal sends, so the two paths cannot drift apart. */
export function stepUpRequired(res: Response, maxAgeSec: number, why: string): void {
  res.status(403).json({
    ...apiError(STEP_UP_CODE, why),
    maxAgeSec,
  });
}
