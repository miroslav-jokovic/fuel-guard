import type { Icon } from "@silvicom/ui/icons";
import {
  NAV_SURFACES,
  SURFACE_GROUPS,
  canReachSurface,
  surfaceAllowed,
  type SectionClaim,
  type UserRole,
  type ModuleSet,
  type SurfaceClaim,
} from "@silvicom/shared";
import { SURFACE_ICONS, GROUP_ICONS } from "./navIcons";

export interface NavItem {
  name: string;
  to: string;
  icon: Icon;
  show: boolean;
  /** Optional count badge (e.g. pending hazmat reviews). Rendered only when > 0. */
  badge?: number;
}

/** Live counts injected into the nav (kept out of the static catalogue). */
export interface NavCounts {
  hazmatReview?: number;
  messagesUnread?: number;
}

export interface NavGroup {
  /** Section label (null = ungrouped top items). */
  label: string | null;
  /** Section icon shown in the collapsed rail (labeled sections only). */
  icon?: Icon;
  items: NavItem[];
}

/**
 * The sidebar, folded out of the surface catalogue
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S1, D-SURF3).
 *
 * This file used to BE the catalogue: 37 hand-written entries, each repeating which section it
 * needed as a `show:` expression. That was one home for the fact, and correct — until anything else
 * needed the same answer. It measured out badly: of the 31 entries gated on a section, only 3 had a
 * route that gated on anything, so 28 URLs stayed reachable for a role whose menu entry was hidden,
 * and `/settings` had the mismatch reversed (gated at `manage` while this file asked `view`, which
 * bounced the one role it was added for).
 *
 * The answer now lives in `SURFACES` in `packages/shared`, and the router guard (S2) and the API
 * (S3) read the same one. `show` is still UI gating ONLY — RLS and the API's section checks are the
 * real enforcement, and S2 is what makes the router agree. What changed is that the gate is no
 * longer WRITTEN here; it is READ, so the sidebar can no longer disagree with anything by hand.
 *
 * Icons stay in `navIcons.ts` because shared is compiled for React Native and cannot import Vue
 * components (D-SURF3); `lint:surfaces` keeps the two key sets equal in both directions.
 */
export function buildNavGroups(
  role: UserRole | null,
  modules: ModuleSet | null,
  counts: NavCounts = {},
  /**
   * The org's overrides of this role, from the caller's token (D-PERM2). Optional, and omitting it
   * means the shipped matrix — which is what every pre-0291 token carries, and what the permissions
   * page passes when previewing a role rather than a person.
   */
  sections: SectionClaim | null = null,
  /**
   * The org's answers about which SCREENS this role may reach (D-SURF1, S3). Optional, and omitting
   * it means "no denials" — which is what every caller passed before S3 and what the permissions page
   * passes when previewing the shipped catalogue rather than a live org.
   */
  surfaces: SurfaceClaim | null = null,
): NavGroup[] {
  return SURFACE_GROUPS.map((g) => ({
    label: g.label,
    ...(GROUP_ICONS[g.key] ? { icon: GROUP_ICONS[g.key] } : {}),
    items: NAV_SURFACES.filter((s) => s.group === g.key)
      .map((s) => ({
        name: s.label,
        to: s.path,
        icon: SURFACE_ICONS[s.key]!,
        show: canReachSurface(s, role, modules, sections) && surfaceAllowed(s, role, sections, surfaces),
        ...(s.badge ? { badge: counts[s.badge] } : {}),
      }))
      .filter((i) => i.show),
  })).filter((g) => g.items.length > 0);
}
