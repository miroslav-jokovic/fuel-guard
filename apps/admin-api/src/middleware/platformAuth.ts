import type { Request, Response, NextFunction } from "express";
import { apiError } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { verifyPlatformToken, getProjectJwks, type AmrEntry } from "../lib/auth.js";
import { lookupPlatformAdmin, type PlatformRole } from "../lib/platformAdmins.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";

/** Step-up "sudo" freshness window for destructive/sensitive actions. */
export const STEP_UP_WINDOW_MS = 5 * 60_000;

/**
 * 1 — Verify the Supabase JWT (identity). Attaches req.platformToken. 401 if missing/invalid.
 * Identity only — authority is decided later by requirePlatformAdmin (allowlist), never by a claim.
 */
export function requirePlatformAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json(apiError("unauthorized", "Missing bearer token"));
    return;
  }
  const locals = getAppLocals(req);
  const verify =
    locals.verifyToken ?? ((t: string) => verifyPlatformToken(t, getProjectJwks(locals.env)));
  verify(token)
    .then((tok) => {
      req.platformToken = tok;
      next();
    })
    .catch(() => res.status(401).json(apiError("unauthorized", "Invalid or expired token")));
}

/** 2 — Require MFA assurance level aal2. Enrollment/challenge routes are the ONLY aal1-permitted paths. */
export function requireAAL2(req: Request, res: Response, next: NextFunction): void {
  if (req.platformToken?.aal !== "aal2") {
    res.status(403).json(apiError("mfa_required", "Multi-factor authentication required"));
    return;
  }
  next();
}

/**
 * 3 — Authorize against the platform allowlist with a FRESH lookup. Attaches req.platform.
 * 403 if the verified user is not an active platform admin. Instant revocation (no cached claim).
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const tok = req.platformToken;
  if (!tok) {
    res.status(401).json(apiError("unauthorized", "Not authenticated"));
    return;
  }
  const locals = getAppLocals(req);
  const lookup =
    locals.lookupPlatformAdmin ??
    ((id: { userId: string; email: string | null }) => lookupPlatformAdmin(getSupabaseAdmin(locals.env), id));
  lookup({ userId: tok.userId, email: tok.email })
    .then((admin) => {
      if (!admin) {
        res.status(403).json(apiError("forbidden", "Not a platform administrator"));
        return;
      }
      req.platform = admin;
      next();
    })
    .catch(() => res.status(500).json(apiError("internal_error", "Authorization check failed")));
}

/** 4 — Require one of the given platform roles (least-privilege RBAC within the plane). */
export function requirePlatformRole(...roles: PlatformRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.platform?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json(apiError("forbidden", "Insufficient platform role"));
      return;
    }
    next();
  };
}

/**
 * A second factor counts as "strong". `totp` is what GoTrue writes today; the `mfa/` prefix covers the
 * newer `mfa/totp`, `mfa/phone`, `mfa/webauthn` forms. An unknown `mfa/*` factor is treated as strong
 * on purpose — this feeds a DENY gate, so the safe default for an unrecognised second factor is to let
 * a legitimate operator through rather than to lock the platform plane out on a GoTrue rename.
 * Everything else (`password`, `otp`, `magiclink`, `oauth`, `sso/saml`, `recovery`) is single-factor.
 */
const STRONG_AMR_PREFIX = "mfa/";
const STRONG_AMR_METHODS = new Set(["totp"]);
const isStrongAmrMethod = (m: string): boolean =>
  STRONG_AMR_METHODS.has(m) || m.startsWith(STRONG_AMR_PREFIX);

/**
 * When did this caller last prove a SECOND factor? Milliseconds, or null when they never did.
 * Exported for the tests, which assert the boundary against STEP_UP_WINDOW_MS rather than a literal.
 */
export function latestStrongAuthAt(amr: AmrEntry[] | null | undefined): number | null {
  if (!amr) return null;
  let latest: number | null = null;
  for (const entry of amr) {
    if (!isStrongAmrMethod(entry.method)) continue;
    const ts = entry.timestamp;
    // A strong method with no usable timestamp proves nothing about FRESHNESS, which is the only
    // thing this gate measures. Skip it rather than crediting it with `now`.
    if (ts === null || !Number.isFinite(ts) || ts <= 0) continue;
    const ms = ts * 1000; // GoTrue issues amr timestamps in SECONDS
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/**
 * 5 — Step-up "sudo": require a RECENT second factor for destructive/sensitive actions.
 *
 * Freshness comes from the caller's own token. The `amr` claim is a timestamped history of
 * authentication events, so "how long ago did this person prove a second factor" is already in the
 * JWT — no re-auth endpoint, no column to write, nothing to keep in sync, and nothing an attacker
 * holding only a stolen access token can refresh.
 *
 * It previously read platform_admins.last_reauth_at, which NOTHING in this codebase has ever written
 * (audit 2026-08-09, finding 3.8). That made the middleware fail-closed on every request — which did
 * not matter, because no route applied it either. Cross-tenant impersonation, entitlement grants and
 * module kill-switches therefore ran on an hour-long access token with no re-authentication at all,
 * while the column and the docs both claimed otherwise. A control that is documented but absent is
 * worse than one that is simply missing: it gets relied upon.
 *
 * Still fails closed: no amr, no strong method, or no usable timestamp all deny. The `step_up_required`
 * code is what the admin UI branches on to raise a fresh MFA challenge.
 */
export function requireStepUp(req: Request, res: Response, next: NextFunction): void {
  const strongAt = latestStrongAuthAt(req.platformToken?.amr);
  if (strongAt === null || Date.now() - strongAt > STEP_UP_WINDOW_MS) {
    res.status(403).json(apiError("step_up_required", "Re-authentication required for this action"));
    return;
  }
  next();
}
