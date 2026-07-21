import type { Request, Response, NextFunction } from "express";
import { apiError } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { verifyPlatformToken, getProjectJwks } from "../lib/auth.js";
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
 * 5 — Step-up "sudo": require a recent re-authentication for destructive/sensitive actions. Supabase has
 * no built-in "re-authed within N minutes", so we stamp platform_admins.last_reauth_at on a fresh MFA
 * challenge and check its freshness here. Fails closed.
 */
export function requireStepUp(req: Request, res: Response, next: NextFunction): void {
  const stamp = req.platform?.lastReauthAt ? Date.parse(req.platform.lastReauthAt) : NaN;
  if (!Number.isFinite(stamp) || Date.now() - stamp > STEP_UP_WINDOW_MS) {
    res.status(403).json(apiError("step_up_required", "Re-authentication required for this action"));
    return;
  }
  next();
}
