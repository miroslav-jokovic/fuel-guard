import { EDITABLE_ROLES } from "./auth.js";
import type { UserRole } from "./constants.js";
import { GRANTABLE_SURFACES } from "./surfaceCatalogue.js";
import type { SurfaceClaim, SurfaceOverrides } from "./surfaces.js";

/**
 * A carrier's screen answers as stored (`org_role_surface_access` 0296, `user_surface_access` 0298),
 * turned into the shapes `surfaceAllowed` takes (D-SURF6).
 *
 * Moved here from the API's `org/routes/surfaceAccess.ts` on 2026-11-16 (LUMPER-REVISED-RC-PLAN LRC4),
 * unchanged, because a second reader needs them: the alert resolver asks "can this person open the
 * Lumper fees screen?" for every member when it sends a lumper reminder, and `messaging` cannot import
 * `org` (org already imports messaging). One definition of which stored rows count, for both.
 */

export interface SurfaceRow {
  role: string;
  surface_key: string;
  allowed: boolean;
}

export interface UserSurfaceRow {
  surface_key: string;
  allowed: boolean;
}

const KNOWN_KEYS = new Set(GRANTABLE_SURFACES.map((s) => s.key));

/**
 * Rows → the sparse `role → key → allowed` shape the shared resolver takes (D-SURF6).
 *
 * Rows naming an uneditable role, or a key the catalogue does not have, are SKIPPED rather than
 * trusted. 0296 deliberately leaves `surface_key` unconstrained because a bad key is inert in SQL —
 * this is where "inert" is actually made true, and it matters most for a key that USED to exist:
 * a screen removed from the catalogue must not leave its old denial applying to nothing, or worse,
 * to a key some later surface reuses.
 */
export function toSurfaceOverrides(rows: readonly SurfaceRow[]): SurfaceOverrides {
  const out: SurfaceOverrides = {};
  for (const r of rows) {
    if (!(EDITABLE_ROLES as readonly string[]).includes(r.role)) continue;
    if (!KNOWN_KEYS.has(r.surface_key)) continue;
    (out[r.role as UserRole] ??= {})[r.surface_key] = r.allowed;
  }
  return out;
}

/**
 * The rows for ONE member, sparse (D-SURF7). Unlike the role layer, `true` is a real answer here —
 * it is how a single technician keeps a screen the org took from `technician` — so nothing is
 * filtered on value, only on whether the catalogue still knows the key.
 */
export function toUserSurfaceClaim(rows: readonly UserSurfaceRow[]): SurfaceClaim {
  const out: SurfaceClaim = {};
  for (const r of rows) {
    if (!KNOWN_KEYS.has(r.surface_key)) continue;
    out[r.surface_key] = r.allowed;
  }
  return out;
}

/**
 * One member's screen claim as `surfaceClaimFor` builds it for their token: the role's answers with
 * their own over them, and nothing for a role whose answers cannot be edited (admin, driver) — a stray
 * row must not colour their answer.
 */
export function memberSurfaceClaim(role: UserRole, roleOverrides: SurfaceOverrides, userClaim: SurfaceClaim | undefined): SurfaceClaim {
  if (!(EDITABLE_ROLES as readonly string[]).includes(role)) return {};
  return { ...(roleOverrides[role] ?? {}), ...(userClaim ?? {}) };
}
