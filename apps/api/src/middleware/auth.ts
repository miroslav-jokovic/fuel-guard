import type { Request, Response, NextFunction } from "express";
import {
  callerCanManage,
  callerCanView,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { apiError } from "../lib/http.js";
import { verifyAccessToken, getProjectJwks, projectTokenAudience } from "../lib/auth.js";
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
    locals.verifyToken ??
    ((t: string) =>
      verifyAccessToken(t, getProjectJwks(locals.env), projectTokenAudience(locals.env)));

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

/**
 * Require a level of access to a SECTION, resolved against the caller's org overrides (D-PERM3,
 * EDITABLE-PERMISSIONS-PLAN.md P3).
 *
 * This is what `requireRole(...rolesThatManage("fuel"))` meant all along, and the difference matters
 * now that the matrix is editable per org: the spread form computes its role list ONCE, at module
 * load, from the compile-time constant — so an org that granted its dispatchers Safety would still
 * be refused by a gate that decided who was allowed before the process had served a request.
 *
 * Falls back to the shipped default for a token minted before migration 0292, which is every token
 * in existence on the day it applies. Swapping a call site is therefore behaviour-preserving until
 * an override row exists, and that is the property that makes a 71-site rewrite reviewable.
 *
 * ⚠ Keep the `gateKind` marker. `routeGates.test.ts` (P4.2, D-SEP10) walks the mounted middleware
 * stacks to prove every router carries a gate, and it can only see one that declares itself — a gate
 * without the marker reads to that fitness function as an ungated route.
 */
export function requireSection(section: AppSection, level: SectionAccess = "manage") {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role ?? null;
    const sections = req.auth?.sections ?? null;
    const allowed =
      level === "manage"
        ? callerCanManage(role, section, sections)
        : callerCanView(role, section, sections);
    if (!allowed) {
      res.status(403).json(apiError("forbidden", "Insufficient role"));
      return;
    }
    next();
  };
  return Object.assign(handler, { gateKind: "role" as const, section, level });
}

/**
 * Require access to ANY ONE of several sections — a union, where stacking two `requireSection`
 * middlewares would give an intersection.
 *
 * One caller today: the roster archive door, open to somebody who can see the roster OR somebody who
 * can see the applicant board, because the two lists share a table and have different owners. A
 * named export rather than an options bag, because the name is the documentation — "any" is the
 * whole difference, and it is invisible in a call that merely takes more arguments.
 */
export function requireAnySection(...specs: Array<[AppSection, SectionAccess?]>) {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role ?? null;
    const sections = req.auth?.sections ?? null;
    const allowed = specs.some(([section, level = "manage"]) =>
      level === "manage"
        ? callerCanManage(role, section, sections)
        : callerCanView(role, section, sections),
    );
    if (!allowed) {
      res.status(403).json(apiError("forbidden", "Insufficient role"));
      return;
    }
    next();
  };
  return Object.assign(handler, { gateKind: "role" as const, specs });
}

/** Require one of the given app roles. */
export function requireRole(...roles: UserRole[]) {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json(apiError("forbidden", "Insufficient role"));
      return;
    }
    next();
  };
  // Runtime marker for routeGates.test.ts (P4.2, D-SEP10): the role-coverage fitness function
  // walks the mounted middleware stacks and can only see a gate that declares itself.
  return Object.assign(handler, { gateKind: "role" as const });
}
