import type { Request, Response, NextFunction } from "express";
import {
  DEVICE_KEY_HEADER,
  DEVICE_LIMIT,
  DEVICE_LIMIT_REACHED,
  SECOND_FACTOR_REQUIRED,
  callerCanManage,
  callerCanView,
  isAdmin,
  type AdminOnlyCapability,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { apiError } from "../lib/http.js";
import { verifyAccessToken, getProjectJwks, projectTokenAudience } from "../lib/auth.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { membershipVerdict } from "./membershipCurrent.js";
import * as Sentry from "@sentry/node";

/** The token is genuine but names a membership that was removed, re-roled or suspended since (SP7). */
class AccessChanged extends Error {}
/** The token is genuine but its session was ended — the device was signed out (Q-IA10, 0616). */
class SignedOut extends Error {}
/** The token is genuine but its owner must take the second step and this session has not (IA-S1, 0617). */
class SecondStepNeeded extends Error {}
/** The token is genuine but its device is a fourth: the account already holds its three places (IA-S6, 0620). */
class DeviceLimit extends Error {}

/** Which one refusal a router may waive — each is a separate door, and none waives the other. */
interface Waive {
  firstStep?: boolean;
  deviceLimit?: boolean;
}

/**
 * Authenticate the request from its Bearer token. Attaches req.auth (audit B5: org_id/role come
 * from the verified JWT, NEVER the request body). Tests may inject app.locals.verifyToken.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next, {});
}

/**
 * `requireAuth` for the ONE router a one-step token may still call: `/api/me/second-factor`, which tells
 * the app that a code is needed (IA-S1). Everything else about the token is checked exactly as above —
 * signature, membership, session — and only the second-step refusal is waived. Without it an admin whose
 * date had passed would be refused by every route including the one that could say why.
 */
export function requireAuthFirstStep(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next, { firstStep: true });
}

/**
 * `requireAuth` for the routes a FOURTH device may still call (IA-S6, Q-IA14 (b)): the person's own devices and
 * signing one of them out — `/api/me/devices` and `/api/me/sessions`. Without them the device that was stopped
 * could not do the one thing the refusal asks of it. Signature, membership, session and second step are all
 * checked as above; only the device-limit refusal is waived.
 */
export function requireAuthOverLimit(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next, { deviceLimit: true });
}

function authenticate(req: Request, res: Response, next: NextFunction, waive: Waive): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json(apiError("unauthorized", "Missing bearer token"));
    return;
  }

  const locals = getAppLocals(req);
  // A token is signed AND its membership is still the one it names (SP7, Q-SET6 (a) —
  // membershipCurrent.ts says why and what it costs). A test that injects `verifyToken` replaces the
  // whole verification, signature and membership alike, exactly as it did before.
  const verify =
    locals.verifyToken ??
    (async (t: string) => {
      const ctx = await verifyAccessToken(t, getProjectJwks(locals.env), projectTokenAudience(locals.env));
      // The device key rides beside the token, not in it: it only names the device for 0620's record.
      const verdict = await membershipVerdict(getSupabaseAdmin(locals.env), { ...ctx, deviceKey: req.get(DEVICE_KEY_HEADER) ?? null });
      if (verdict === "stale") throw new AccessChanged();
      if (verdict === "signed_out") throw new SignedOut();
      if (verdict === "second_factor" && !waive.firstStep) throw new SecondStepNeeded();
      if (verdict === "device_limit" && !waive.deviceLimit) throw new DeviceLimit();
      return ctx;
    });

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
    .catch((err: unknown) => {
      if (err instanceof AccessChanged) {
        res.status(401).json(apiError("access_changed", "Your access to this organization has changed. Sign in again."));
        return;
      }
      // The SAME code as a changed membership, on purpose: what a client must do is identical — try to
      // renew, which fails because the session is gone, and sign in — and the web already does exactly
      // that for `access_changed` (lib/api.ts). Only the sentence differs.
      if (err instanceof SignedOut) {
        res.status(401).json(apiError("access_changed", "This device was signed out. Sign in again."));
        return;
      }
      // 403, not 401: the token is good and must NOT be thrown away — the same session becomes `aal2` once
      // the code is entered. The web sends the person to the code page on this code (lib/api.ts).
      if (err instanceof SecondStepNeeded) {
        res.status(403).json(apiError(SECOND_FACTOR_REQUIRED, "Enter the code from your authenticator app to continue."));
        return;
      }
      // 403, not 401, for the reason the second step's is: the token is good and must be kept — it is the one
      // the person uses to sign another device out, after which the same session is let in.
      if (err instanceof DeviceLimit) {
        res.status(403).json(apiError(DEVICE_LIMIT_REACHED, `You are signed in on ${DEVICE_LIMIT} devices. Sign one out to use this one.`));
        return;
      }
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

/**
 * An act that stays with the admin and is never offered to another role (Q-SET11 (a),
 * SETTINGS-PERMISSIONS-PLAN.md SP11) — gated by NAME, from `ADMIN_ONLY_CAPABILITIES` in shared.
 *
 * Answers exactly what `requireRole("admin")` answered; what it adds is the key. The Permissions page
 * lists the same keys as "Admin only", and `routeGateLedger.test.ts` fails if a key guards no route
 * or a route names a key the list does not hold — so the page and the API cannot disagree about what
 * is the admin's alone. A bare `requireRole("admin")` is still right for Users and Permissions
 * themselves (`ADMIN_ONLY_SURFACES`); this is for the acts that are not a screen of their own.
 *
 * `isAdmin` rather than a section: the `admin` role is not editable (D-PERM7), so an org's overrides
 * can neither narrow this nor widen it, and the claim is not consulted on purpose.
 */
export function requireAdminOnly(capability: AdminOnlyCapability) {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    if (!isAdmin(req.auth?.role)) {
      res.status(403).json(apiError("forbidden", "Insufficient role"));
      return;
    }
    next();
  };
  return Object.assign(handler, { gateKind: "role" as const, adminOnly: capability });
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
  return Object.assign(handler, { gateKind: "role" as const, roles });
}
