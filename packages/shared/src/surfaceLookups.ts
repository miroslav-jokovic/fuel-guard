import type { Surface } from "./surfaces.js";
import { SURFACES } from "./surfaceCatalogue.js";

/**
 * Questions asked OF the catalogue, beside it rather than in it: `surfaceCatalogue.ts` is the list
 * and what is derived at load (the nav, the grantable set, the admin-only set), and it sits at the
 * 500-line budget. These two read it on demand and need nothing else. Split out when office chat's
 * entry (OFFICE-CHAT-PLAN CH2) took the catalogue past the budget.
 */

/** The screens a directory surface links to, in catalogue order — `/settings`'s cards (SP1). */
export const directoryScreens = (directoryKey: string): readonly Surface[] =>
  SURFACES.filter((s) => s.reachedFrom === directoryKey);

/** The surface a declared route path belongs to, or undefined if the route is not catalogued. */
export function surfaceForPath(path: string): Surface | undefined {
  return SURFACES.find((s) => s.path === path);
}
