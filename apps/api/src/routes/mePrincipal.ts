import type { Request, RequestHandler, Response } from "express";
import type { SurfaceClaim, UserRole } from "@silvicom/shared";
import type { Env } from "../env.js";
import { asyncHandler } from "../lib/http.js";
import { displayNameFor } from "../lib/memberLabels.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { callerNamedPermissions, surfaceClaimFor } from "../modules/org/index.js";

/**
 * Current principal from the verified JWT (org/role may be null until membership exists), plus the
 * org's SCREEN entitlements for this caller's role.
 *
 * ⚠ Why the surfaces travel here and NOT in the token, when sections do (D-SURF4). Sections must be
 * a claim: RLS reads them per row, and `auth_section()` has to inline — this repo has the measured
 * number for breaking that, 128x, and the outage it caused. Nothing in RLS reads a SURFACE, so
 * putting them in the token would buy nothing and cost the one thing the claim costs: a permission
 * change that lands up to an hour later, when `jwt_expiry` is 3600. Served from here, a screen
 * change lands on the next page load.
 *
 * The web calls this in `session.init()`, which the router guard already awaits, so the guard reads
 * the answer synchronously and there is no window where a route resolves against a stale one.
 *
 * Lifted out of `app.ts` unchanged on 2026-11-13, when that file stood at 499 of its 500 lines. The
 * route itself is still declared there (`app.get("/api/me", requireAuth, …)`), so the order it is
 * mounted in and the `requireAuth` in front of it are read where every other mount is.
 */
export function mePrincipalHandler(env: Env): RequestHandler {
  return asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    /**
     * ⚠ The screen answers must NEVER be able to break this endpoint. `/api/me` is the identity the
     * web bootstraps from, and it answered before surfaces existed; a Supabase-admin misconfiguration
     * turning it into a 500 would take the whole app down for a permissions refinement. That is not
     * hypothetical: written without this guard, it broke
     * "/api/me returns the principal for a valid token" in `../middleware/auth.test.ts` immediately.
     *
     * Falling back to `{}` is the same fail-OPEN `surfaceClaimFor` documents, applied one layer out
     * where `getSupabaseAdmin` itself can throw. It is safe for the same reason: a surface answer may
     * only NARROW within a section (D-SURF2), so no answer is the shipped catalogue and never more.
     */
    let surfaces: SurfaceClaim = {};
    if (orgId) {
      try {
        surfaces = await surfaceClaimFor(
          getSupabaseAdmin(env),
          orgId,
          req.auth!.role as UserRole | null,
          req.auth!.userId,
        );
      } catch {
        surfaces = {};
      }
    }
    // The caller's display name (0301), fail-open for the reason `displayNameFor` states: a courtesy
    // on the bootstrap path must never be the thing that takes sign-in down. The try is around the
    // CLIENT too — `getSupabaseAdmin` itself can throw, and the first draft left it outside and broke
    // "/api/me returns the principal for a valid token" exactly as the surfaces guard above predicted.
    let fullName: string | null;
    try {
      fullName = await displayNameFor(getSupabaseAdmin(env), req.auth!.userId, orgId, req.auth!.role);
    } catch {
      fullName = null;
    }
    // Named permissions (§15.1), so a screen hides what `requireNamedPermission` refuses; never throws.
    const permissions = await callerNamedPermissions(req, orgId ?? null, req.auth!.role as UserRole | null);
    res.json({ userId: req.auth!.userId, email: req.auth!.email, fullName, orgId, role: req.auth!.role, surfaces, permissions });
  });
}
