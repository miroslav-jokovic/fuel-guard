import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@fuelguard/shared";
import { apiError } from "../lib/http.js";
import { verifyAccessToken, getProjectJwks } from "../lib/auth.js";
import { getAppLocals } from "../lib/appLocals.js";
import * as Sentry from "@sentry/node";

/**
 * Authenticate the request from its Bearer token. Attaches req.auth (audit B5: org_id/role come
 * from the verified JWT, NEVER the request body). Tests may inject app.locals.verifyToken.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json(apiError("unauthorized", "Missing bearer token"));
    return;
  }

  const locals = getAppLocals(req);
  const verify =
    locals.verifyToken ?? ((t: string) => verifyAccessToken(t, getProjectJwks(locals.env)));

  verify(token)
    .then((ctx) => {
      req.auth = ctx;
      // Enrich the Sentry request scope (no-op unless initialised): user id only (no email/PII),
      // org_id + role as searchable tags.
      Sentry.setUser({ id: ctx.userId });
      if (ctx.orgId) Sentry.setTag("org_id", ctx.orgId);
      if (ctx.role) Sentry.setTag("role", ctx.role);
      next();
    })
    .catch(() => {
      res.status(401).json(apiError("unauthorized", "Invalid or expired token"));
    });
}

/** Require the authenticated user to belong to an org (have a membership / org claim — audit B3). */
export function requireOrg(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.orgId) {
    res.status(403).json(apiError("no_membership", "Account is not linked to an organization yet"));
    return;
  }
  next();
}

/** Require one of the given app roles. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json(apiError("forbidden", "Insufficient role"));
      return;
    }
    next();
  };
}
