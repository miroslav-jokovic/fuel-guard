import {
  callerCanManage,
  callerCanView,
  ACCESS_LABELS,
  type AppSection,
  type SectionAccess,
  type SectionClaim,
  type UserRole,
  surfaceStartsOn,
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
 *
 * ⚠ The precedence itself — `sectionCell`, `surfaceCell`, the merged claims and the layer words —
 * lives in `@silvicom/shared` (`accessLayers.ts`) since SP10 (Q-SET10): the access-review export is
 * rendered by the API and has to tag each cell exactly as this page does, so the rule moved to the
 * package both read and is re-exported here unchanged. Edit it there.
 */
export {
  LAYER_LABELS,
  mergedSectionClaim,
  mergedSurfaceClaim,
  sectionCell,
  surfaceCell,
  type AccessLayer,
  type SectionCell,
  type SurfaceCell,
} from "@silvicom/shared";

/** The three answers a section takes, in the order the control shows them. */
export const ACCESS_OPTIONS: ReadonlyArray<{ value: SectionAccess; label: string }> = (
  ["none", "view", "manage"] as const
).map((value) => ({ value, label: ACCESS_LABELS[value] }));
export const accessLabel = (a: SectionAccess): string =>
  ACCESS_OPTIONS.find((o) => o.value === a)?.label ?? a;

/**
 * Where a catalogue entry starts for a role, asked through the same shared function the guard falls
 * back to, so a cell and the router cannot disagree about "no answer". The entry arrives from the API
 * rather than from the bundled catalogue — every read brings its own yardstick (`usePermissions.ts`).
 */
export const entryStartsOn = (s: { startsOnFor: UserRole[] | null }, role: UserRole | null): boolean =>
  surfaceStartsOn({ startsOnFor: s.startsOnFor ?? undefined }, role);

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
