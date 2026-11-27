import { isEditableSurface, type Surface } from "./surfaces.js";
import { SURFACES } from "./surfaceCatalogue.js";

/**
 * Questions asked OF the catalogue, beside it rather than in it: `surfaceCatalogue.ts` is the list
 * and what is derived at load (the nav, the grantable set, the admin-only set), and it sits at the
 * 500-line budget. These read it and need nothing else. Split out when office chat's entry
 * (OFFICE-CHAT-PLAN CH2) took the catalogue past the budget; the admin-only set followed when the
 * Printers & scanners screen did (PRINTERS-AND-SCANNERS-PLAN.md PS4), and the sidebar list and the
 * grantable set when Broker mail's two screens did (BROKER-MAIL-READER-PLAN P2).
 */

/** The screens a directory surface links to, in catalogue order — `/settings`'s cards (SP1). */
export const directoryScreens = (directoryKey: string): readonly Surface[] =>
  SURFACES.filter((s) => s.reachedFrom === directoryKey);

/** The surface a declared route path belongs to, or undefined if the route is not catalogued. */
export function surfaceForPath(path: string): Surface | undefined {
  return SURFACES.find((s) => s.path === path);
}

/**
 * Q-SET1 (owner's ruling 2026-09-30): the screens that stay admin-only and are never offered —
 * Users, Permissions, Card control and EFS integration. DERIVED from the `ADMIN` gate rather than
 * listed, so the ruling cannot be restated in one place and contradicted in another; a test pins the
 * four keys, so a fifth `ADMIN` gate is a decision somebody has to make on purpose.
 */
export const ADMIN_ONLY_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.gate.kind === "admin");

/**
 * The surfaces that render in the sidebar — everything except the detail routes (D-SURF8) and the
 * screens a directory links to instead (`reachedFrom`, SP1).
 */
export const NAV_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.parent === undefined && s.reachedFrom === undefined);

/**
 * The screens an organisation may answer for, per role and per person: a section gate (Q-SURF3 —
 * `isEditableSurface`) and a grant of its own (not a `parent`, D-SURF8). The Permissions page's
 * rows, the API's accepted keys and the stored-row filter all read this one list.
 */
export const GRANTABLE_SURFACES: readonly Surface[] = SURFACES.filter((s) => isEditableSurface(s) && s.parent === undefined);
