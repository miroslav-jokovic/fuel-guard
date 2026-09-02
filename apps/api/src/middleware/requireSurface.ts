import type { Request, Response, NextFunction } from "express";
import { SURFACES, surfaceAllowed, type UserRole } from "@silvicom/shared";
import { apiError } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { surfaceClaimFor } from "../modules/org/index.js";

/**
 * The API half of a SCREEN entitlement (D-SURF5, SURFACE-ENTITLEMENTS-PLAN.md S3).
 *
 * ── WHAT THIS MAY BE PUT ON, AND WHAT IT MUST NOT ───────────────────────────────────────────────
 * ONLY an endpoint that a single screen uses. An endpoint two screens call stays gated at the
 * SECTION level and never gets this, because denying one screen must not break the other — and that
 * is not a hypothetical. `GET /api/maintenance/inspectors` backs both the Inspectors register AND
 * the New Inspection drawer on the Annual Inspections page (`NewInspectionDrawer.vue:76`); putting a
 * surface gate on it to hide the register would stop a technician being able to start an inspection,
 * which is the exact failure that made screens and sections separate vocabularies in the first place.
 *
 * The writes are a different matter: `POST`/`PATCH`/`DELETE .../inspectors` are reached from the
 * register and nowhere else, so they belong to it. `lint:surfaces` cross-checks every key named here
 * against the catalogue.
 *
 * ── IT NARROWS, IT NEVER GRANTS ─────────────────────────────────────────────────────────────────
 * This runs BESIDE the endpoint's `requireSection`, never instead of it. `surfaceAllowed` checks the
 * section gate first for the same reason (D-SURF2), so an org's `allowed: true` can never lift a
 * caller past a section they do not hold. Removing the `requireSection` and keeping this would be a
 * privilege escalation dressed as a refactor.
 *
 * ── WHY IT READS THE TABLE PER REQUEST ──────────────────────────────────────────────────────────
 * Surfaces are deliberately NOT in the JWT (D-SURF4): nothing in RLS reads them, so the token would
 * gain size and an hour of staleness for nothing. That leaves one small indexed read per gated
 * request — and this middleware is on a handful of write endpoints, not on the read path, so the
 * cost lands where a round trip is already the smallest part of the work.
 */
export function requireSurface(key: string) {
  if (!SURFACES.some((s) => s.key === key)) {
    // Fail at construction rather than per request: a typo'd key would otherwise gate on a surface
    // that does not exist, which `surfaceAllowed` answers `true` for — an open door that reads as a
    // closed one. `lint:surfaces` catches it before this can run, and this is the belt.
    throw new Error(`requireSurface("${key}") names no surface in the catalogue`);
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const orgId = req.auth?.orgId;
    if (!orgId) {
      res.status(403).json(apiError("no_membership", "Account is not linked to an organization yet"));
      return;
    }
    const surface = SURFACES.find((s) => s.key === key)!;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    void (async () => {
      try {
        const role = (req.auth?.role ?? null) as UserRole | null;
        const claim = await surfaceClaimFor(admin, orgId, role);
        if (!surfaceAllowed(surface, role, req.auth?.sections ?? null, claim)) {
          res.status(403).json(apiError("surface_denied", `Your organisation has not given your role access to ${surface.label}.`));
          return;
        }
        next();
      } catch (e) {
        next(e instanceof Error ? e : new Error("Screen entitlement check failed"));
      }
    })();
  };
}
