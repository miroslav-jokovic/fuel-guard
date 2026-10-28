import { SURFACES, surfaceForPath } from "@silvicom/shared";
import type { NavGroup } from "./nav";

/**
 * The sections whose primary size is a phone or a tablet (D-MX5; DESIGN-SYSTEM-CONTRACT.md §9).
 *
 * The shop is used standing in a bay — a maintenance employee, the in-shop workers and the inspector,
 * on a tablet or a phone with a scanner and a label printer (Q-MX1) — and the rest of the product is
 * used at a desk. That is a fact about a SECTION, so it is stated once here, by the catalogue's group
 * key, and the two things that follow from it read it: the touch floor (`provideTouchTargets` in
 * `AppShell`) and the section's tab row (`phoneTabs` below). Which screens belong to the section is
 * the catalogue's answer (`surfaceForPath`), never a path prefix typed here.
 */
export const PHONE_FIRST_GROUPS: ReadonlySet<string> = new Set(["maintenance"]);

/** Whether the route declared at `matchedPath` belongs to a phone-first section. */
export function isPhoneFirst(matchedPath: string): boolean {
  const group = surfaceForPath(matchedPath)?.group;
  return group !== undefined && PHONE_FIRST_GROUPS.has(group);
}

/**
 * The tab row for the page at `matchedPath`: its section's sidebar rows, or null (rule 7).
 *
 * The rows are the sidebar's own, already folded by `buildNavGroups` against the role, the org's
 * overrides and its screen answers — so a role that cannot reach a door never sees its tab, and a
 * role with no maintenance section never reaches a page that would draw the row. One door is not a
 * row of doors: a role left with a single shop screen keeps the hamburger and nothing else.
 */
export function phoneTabs(matchedPath: string, groups: readonly NavGroup[]): NavGroup | null {
  const group = surfaceForPath(matchedPath)?.group;
  if (group === undefined || !PHONE_FIRST_GROUPS.has(group)) return null;
  const found = groups.find((g) => g.key === group);
  return found && found.items.length > 1 ? found : null;
}

/**
 * Which tab the page at `matchedPath` stands under: the path of the sidebar row its catalogue
 * `parent` chain ends at. Equipment's parent is Trucks & trailers and Scan's is Shop, which no path
 * prefix could say — `/shop/assets` starts with `/shop`, and so does every page in the section.
 */
export function phoneTabFor(matchedPath: string): string | null {
  let surface = surfaceForPath(matchedPath);
  for (let depth = 0; surface?.parent && depth < 5; depth += 1) {
    const parent: string = surface.parent;
    surface = SURFACES.find((s) => s.key === parent);
  }
  return surface?.path ?? null;
}
