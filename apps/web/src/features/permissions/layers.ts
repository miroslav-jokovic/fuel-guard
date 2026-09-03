import {
  callerCanManage,
  callerCanView,
  type AppSection,
  type SectionAccess,
  type SectionClaim,
  type SurfaceClaim,
  type UserRole,
} from "@silvicom/shared";

/**
 * Which layer answered a cell, and what the two answers mean when they are saved
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S6, D-SURF6).
 *
 * ── WHY THE PAGE NEEDS THIS AND NOTHING ELSE DOES ───────────────────────────────────────────────
 * Every other consumer of a permission resolves the chain and forgets it: `custom_access_token_hook`
 * mints one value per section, `surfaceClaimFor` merges the person over the role, and a request only
 * ever asks "may I". The permissions page is the one place where the ANSWER is not enough. A cell
 * reading `View` with no idea whether that came from the shipped matrix, from the org's answer for
 * that role, or from this one person's row is a control an admin cannot use — "reset" and "set it to
 * view" look identical on it and do entirely different things, one of which keeps tracking the role
 * afterwards and one of which does not.
 *
 * So the API sends the layers unmerged (`GET /api/section-access/user/:id`) and this module says
 * which one won. The precedence it applies is D-SURF6's, the same order the server resolves in.
 */
export type AccessLayer = "default" | "role" | "user";

/**
 * The words on a cell's marker, and in the tests that pin them. One word each, because the marker
 * sits beside the control on every row and a two-word tag eleven times over is noise: "Default" is
 * the shipped matrix, "Role" is what this organisation answered for the whole role, "Personal" is
 * this one person's own row.
 */
export const LAYER_LABELS: Record<AccessLayer, string> = {
  default: "Default",
  role: "Role",
  user: "Personal",
};

/** The three answers a section takes, in the order the control shows them. */
export const ACCESS_OPTIONS: ReadonlyArray<{ value: SectionAccess; label: string }> = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "manage", label: "Manage" },
];
export const accessLabel = (a: SectionAccess): string =>
  ACCESS_OPTIONS.find((o) => o.value === a)?.label ?? a;

export interface SectionCell {
  access: SectionAccess;
  layer: AccessLayer;
}

/**
 * One section cell for one MEMBER: shipped default → org role override → this person's override.
 *
 * `undefined` at a layer means that layer said nothing, which is D-PERM4's sparseness — never a
 * denial. Note the middle layer is where a role-level page and a person-level page differ: for a
 * ROLE there are only two layers, because the person's row does not apply to the role.
 */
export function sectionCell(
  shipped: SectionAccess,
  roleOverride: SectionAccess | undefined,
  userOverride: SectionAccess | undefined,
): SectionCell {
  if (userOverride !== undefined) return { access: userOverride, layer: "user" };
  if (roleOverride !== undefined) return { access: roleOverride, layer: "role" };
  return { access: shipped, layer: "default" };
}

export interface SurfaceCell {
  allowed: boolean;
  layer: AccessLayer;
}

/**
 * One screen cell.
 *
 * ⚠ There is no shipped per-screen default to compare against, and the absence is the design rather
 * than a gap: a screen's shipped answer IS its section gate (D-SURF2), which is asked separately by
 * `sectionReaches` below. What an org's row can do is narrow within that, so "no row anywhere" reads
 * as allowed — the catalogue as it shipped.
 */
export function surfaceCell(
  roleOverride: boolean | undefined,
  userOverride: boolean | undefined,
): SurfaceCell {
  if (userOverride !== undefined) return { allowed: userOverride, layer: "user" };
  if (roleOverride !== undefined) return { allowed: roleOverride, layer: "role" };
  return { allowed: true, layer: "default" };
}

/**
 * The claims a MEMBER's preview is drawn from — their own answers over their role's (D-SURF6).
 *
 * The same one-line precedence `surfaceClaimFor` applies server-side. It is written again here
 * because the page is previewing an answer that has not been minted yet: the sidebar it draws is the
 * one the member will get on their next page load (screens) or their next token refresh (sections),
 * and neither has happened at the moment an admin is looking at it.
 */
export const mergedSectionClaim = (role: SectionClaim, user: SectionClaim): SectionClaim => ({
  ...role,
  ...user,
});
export const mergedSurfaceClaim = (role: SurfaceClaim, user: SurfaceClaim): SurfaceClaim => ({
  ...role,
  ...user,
});

/**
 * Does this principal's SECTION access reach a screen catalogued at `section` × `level`?
 *
 * The question every screen cell has to ask before it offers anything, because a surface may only
 * ever narrow within its section (D-SURF2): an org cannot grant Import to a role holding `fuel:
 * "view"`, and a control that appeared to do so would be a lie the API then refuses. Asked through
 * the same two functions the sidebar and the router guard ask, so this page cannot develop its own
 * opinion about who can view what.
 */
export function sectionReaches(
  role: UserRole | null,
  section: AppSection,
  level: SectionAccess,
  claim: SectionClaim | null,
): boolean {
  return level === "manage" ? callerCanManage(role, section, claim) : callerCanView(role, section, claim);
}

/**
 * ── THE TWO STALENESS CONTRACTS, WHICH THE PAGE MUST NOT AVERAGE ────────────────────────────────
 * A SECTION change travels in the JWT and lands on the member's next token refresh — up to an hour,
 * because `jwt_expiry = 3600` (D-PERM6). A SCREEN change is served by `/api/me` and lands on their
 * next page load (D-SURF4). The difference is measured and deliberate — RLS reads sections per row
 * and `auth_section()` has to inline, while nothing in RLS reads a surface — so the two saves say
 * two different things, and each sentence lives here rather than being retyped at four call sites.
 */
export const SECTION_SAVE_NOTE = "Data access travels in their sign-in, so it applies within an hour.";
export const SURFACE_SAVE_NOTE = "Screens apply the next time they load a page.";
