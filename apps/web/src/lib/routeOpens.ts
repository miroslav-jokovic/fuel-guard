import { surfaceAllowed, surfaceForPath, type SectionClaim, type SurfaceClaim, type UserRole } from "@silvicom/shared";

/** The four facts about a caller that decide whether a screen opens — all of them off the session. */
export interface RouteCaller {
  role: UserRole | null;
  /** The org's section overrides, from the token (D-PERM2). `null`/absent reads as the shipped matrix. */
  sections?: SectionClaim | null;
  /** The org's and the person's screen answers, from `/api/me` (D-SURF1, D-SURF4). */
  surfaces?: SurfaceClaim | null;
  admin: boolean;
}

/**
 * Does the route declared at `matchedPath` open for this caller — THE answer, asked by the router
 * guard and by every link that points somewhere (SP5, `SETTINGS-PERMISSIONS-PLAN.md` §4b, owner
 * ruling 2026-09-30: "a link is shown exactly when its target opens").
 *
 * ── WHY THIS IS ONE FUNCTION ─────────────────────────────────────────────────────────────────────
 * The guard used to hold this decision inline, and every link in the app then had to restate it. They
 * did, and they restated it wrongly in three different ways, all measured in the SP5 sweep: a
 * dashboard tile to `/coverage` shown to anyone (the guard asks `fleet`), a Settings link offered on
 * `can("settings")` (the guard asks for a screen that starts off for everyone but the admin), and
 * recruiting buttons read from the SHIPPED matrix while the guard reads the org's claim. The previous
 * answer for links, `pathOpens`, asked the right catalogue but exact-matched the path, so
 * `/vehicles/abc` and `/fuel-log?tab=declines` both said "no" — which is why nothing used it except
 * the one link it was written for. A link and a guard that read one function cannot disagree.
 *
 * `matchedPath` is the DECLARED path — `/drivers/:id`, not `/drivers/abc` — because that is what the
 * catalogue is keyed on. Resolving a URL to it is the router's job, done in `useOpens()`, so this stays
 * pure and needs no router to test.
 *
 * An uncatalogued route answers `true`, exactly as the guard always has: `lint:surfaces` fails the
 * build on an authenticated route missing from the catalogue without a waiver saying why, so "not
 * catalogued" is a ruled state (a public page, a redirect), not a hole. Failing closed would lock every
 * waived page out of its own links.
 */
export function routeOpens(matchedPath: string, meta: { requiresAdmin?: boolean }, caller: RouteCaller): boolean {
  // Q-SET1's four admin-only screens. The catalogue says the same thing with an `ADMIN` gate, so this
  // is the guard's second lock kept in the same place as the first rather than a second home.
  if (meta.requiresAdmin && !caller.admin) return false;
  const surface = surfaceForPath(matchedPath);
  return !surface || surfaceAllowed(surface, caller.role, caller.sections ?? null, caller.surfaces ?? null);
}
