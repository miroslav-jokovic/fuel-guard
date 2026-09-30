import type { AppSection, SectionAccess, SectionClaim } from "./auth.js";
import type { UserRole } from "./constants.js";
import { callerCanView, callerCanManage, EDITABLE_ROLES } from "./auth.js";
import type { ModuleKey, ModuleSet } from "./entitlements.js";
import { moduleEnabled } from "./entitlements.js";

/**
 * What a surface IS, and who is allowed to see one — the types and the gate logic
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S1, D-SURF3).
 *
 * ⚠ **The catalogue itself moved to `surfaceCatalogue.ts` on 2026-09-18 (Q-HM8)**, when the
 * combined file reached 500 of its 500 lines. That file is the DATA — which screens exist and what
 * each needs; this one is the TYPES and the LOGIC. The dependency runs catalogue → here, so these
 * functions can be read without scrolling past 280 entries, and adding a screen no longer competes
 * for budget with the rules that govern it. ⚠ `scripts/check-surfaces.mjs` parses the catalogue by
 * path; it names `surfaceCatalogue.ts`, not this file.
 *
 * ── WHY THE CATALOGUE EXISTS AT ALL ─────────────────────────────────────────────────────────────
 * That fact used to live in exactly one place, `apps/web/src/lib/nav.ts`, written 37 times as a
 * `show:` expression. One place sounds correct, and it was — right up until anything else needed the
 * same answer. Measured on 2026-09-02: of the 31 sidebar entries gated on a section, **exactly 3**
 * had a route that gated on anything, so 28 URLs stayed reachable for a role whose menu entry was
 * hidden. `/settings` had the mismatch the other way (gated at `manage` while its entry asked
 * `view`), which meant the one role it was added for — the auditor — was bounced by it for as long
 * as both halves existed.
 *
 * Neither was a bug anybody wrote. They are what happens when the sidebar holds the answer and the
 * router has to remember it. So the answer moved into `SURFACES`, and the sidebar (S1), the router
 * guard (S2) and the per-role/per-user overrides (S3/S4) all read it through the functions below.
 *
 * ── WHY IT IS IN `shared` AND WHAT IT DELIBERATELY OMITS ────────────────────────────────────────
 * The API and the web must agree about it, so it cannot live in either. It carries NO icon, and that
 * is a constraint rather than an oversight: this package depends on `zod` alone and is compiled for
 * React Native (`build:rn`) for `apps/driver`, so importing `@silvicom/ui` here would break that
 * build — and `packages/ui` does not depend on shared either. The web keeps a `Record<key, Icon>`
 * beside `nav.ts`, and `lint:surfaces` asserts the two key sets are equal so the split cannot drift.
 *
 * It also carries no `exclusiveEndpoints` (D-SURF5 — an endpoint names its own surface, so a list
 * here would be a second copy) and no stored `editable` flag (Q-SURF3 — a section gate already says
 * it; see `isEditableSurface`).
 */

/**
 * The four questions a sidebar entry can ask. Measured from the shipped nav rather than invented:
 * 31 entries ask a section, 3 ask "any staff role", 1 asks "admin", and 2 ask nothing at all.
 *
 * ⚠ `always` and `staff` are INDISTINGUISHABLE in the running product, and the distinction is kept
 * anyway. A driver never renders the web sidebar — `router/index.ts` sends them to `/use-the-app`
 * before any route resolves and `App.vue` gives that route the auth layout — so no real caller can
 * tell the two apart. They are kept separate for two reasons. `buildNavGroups` is a pure exported
 * function that the permissions page also calls to preview what a given MEMBER sees, so collapsing
 * them would change what an admin is shown when previewing a driver. And they say different things:
 * Dashboard has no role requirement at all, while Ask AI is deliberately withheld from the driver
 * app. Merging them would be a product decision wearing a refactor's clothes; S1 transcribes, and
 * anything that wants them collapsed can do it deliberately and say why.
 */
export type SurfaceGate =
  | { kind: "section"; section: AppSection; level: SectionAccess }
  | { kind: "always" }
  | { kind: "staff" }
  | { kind: "admin" }
  /**
   * A DIRECTORY entry — today only Settings — which is shown exactly when at least one screen reached
   * from it is (owner, 2026-09-30: "by default only Admin can see them … hide Settings too").
   *
   * ⚠ Derived rather than answered, and on purpose. As its own switch it would be a second answer
   * to a question the screens already settle: grant Organization to a fleet manager and forget the
   * Settings switch, and the grant reaches a page nobody can navigate to; leave Settings on with every
   * screen off, and it opens onto an empty directory. `screens` is filled from `reachedFrom` once the
   * catalogue is built (`surfaceCatalogue.ts`), so the list is never written twice.
   */
  | { kind: "directory"; screens: readonly Surface[] };

export interface Surface {
  /** Stable and storable — this is the primary key an org's override is written against (S3/S4). */
  key: string;
  /** The sidebar name. Text, so it belongs here; the icon does not (see the header). */
  label: string;
  /** The DECLARED route path, params and all, because that is what `to.matched[0].path` gives S2. */
  path: string;
  /** Which group it renders under — a key into `SURFACE_GROUPS`, not a label. */
  group: string;
  gate: SurfaceGate;
  /** AND-ed with the gate. The org must have bought the module as well as be allowed the section. */
  module?: ModuleKey;
  /** Detail routes point at their list surface (D-SURF8) and are never separately grantable. */
  parent?: string;
  /**
   * A screen reached from a DIRECTORY rather than from the sidebar, which is nonetheless its own
   * grant (SETTINGS-PERMISSIONS-PLAN.md SP1). Names the directory's key — today only `admin.settings`.
   *
   * ⚠ Not a `parent`, and the difference is the whole point. A `parent` shares its grant (D-SURF8):
   * until SP1 every Settings screen was a child of `admin.settings`, so an admin could take away
   * "Settings" whole and nothing smaller, and the ten screens that were really decided by
   * `role === "admin"` could not be offered at all. `reachedFrom` keeps them out of the sidebar
   * (`NAV_SURFACES`) the way `parent` did, and gives each its own key, its own row on the Permissions
   * page and its own answer. Denying the directory therefore no longer denies the screens behind it;
   * checked in production 2026-09-30 before the split, no stored override named any `admin.*` key.
   */
  reachedFrom?: string;
  /**
   * Q-SET2 (owner's ruling 2026-09-30): the screen starts OFF for every editable role not named here,
   * and the admin turns it on per role or per person. Absent means the section decides, as it always
   * has for every other screen.
   *
   * ⚠ A list of who starts ON, not of who starts off, and that is deliberate. The ruling is "nobody
   * gains access on the day it ships"; a list of roles to switch off would switch ON any role added
   * to `USER_ROLES` later, which is a deploy granting access — the exact thing Q-SET2 ruled out. A
   * list of who keeps it fails closed instead. The locked roles (D-PERM7/D-PERM8) are not subject to
   * it: nobody can answer for `admin`, so a default it could not be switched out of would be a lock,
   * and `admin` holds every section anyway.
   */
  startsOnFor?: readonly UserRole[];
  /** Live count rendered beside the entry. The value is injected per request, not stored here. */
  badge?: "hazmatReview" | "messagesUnread";
}

/**
 * Anything gated the way a screen is gated (LM9, D-DW1).
 *
 * `Surface` satisfies it and so does `DashboardWidget`, which is the point: the switch in
 * `surfaceGateAllows` is the product's one answer to "may this caller see this thing", and a widget
 * catalogue that re-implemented it would be a second answer to a question the API, the database and
 * the sidebar already agree on. Typed structurally rather than by inheritance so neither catalogue
 * has to know about the other.
 */
export interface Gated {
  gate: SurfaceGate;
  /** AND-ed with the gate — the org must have bought the module as well as be allowed the section. */
  module?: ModuleKey;
}

export interface SurfaceGroup {
  key: string;
  /** `null` renders ungrouped, above every labelled group — Dashboard and Ask AI. */
  label: string | null;
}

/**
 * The gate builders, EXPORTED since LM9 so `DASHBOARD_WIDGETS` builds its gates with these rather
 * than with a second set of its own. A copied `section()` would read identically and drift silently
 * the first time either one learnt a new kind — which is the shape this repo's register calls a
 * workaround with a delay fuse.
 *
 * ⚠ They are used unqualified inside the `SURFACES` literal below, and `check-surfaces.mjs` PARSES
 * that literal looking for `gate: section("…")`. Exporting them does not move a call site, so the
 * parser is unaffected; moving their DEFINITIONS to another file would be fine too, but renaming
 * them at the call site would not.
 */
export const section = (s: AppSection, level: SectionAccess = "view"): SurfaceGate => ({ kind: "section", section: s, level });
export const manage = (s: AppSection): SurfaceGate => section(s, "manage");
export const ALWAYS: SurfaceGate = { kind: "always" };
export const STAFF: SurfaceGate = { kind: "staff" };
export const ADMIN: SurfaceGate = { kind: "admin" };
/** A fresh, empty directory gate per call — its screens are pushed in by the catalogue. */
export const directory = (): SurfaceGate => ({ kind: "directory", screens: [] });

/**
 * Editable is DERIVED, never stored (Q-SURF3, owner's ruling 2026-09-02). A surface is an org's to
 * configure exactly when its gate is a SECTION gate, because a section is the only thing the
 * permission matrix can move. Writing an `editable: false` beside a `staff` gate that already says
 * so would be a second home for one fact — the failure D-SURF3 names.
 */
export const isEditableSurface = (s: Surface): boolean => s.gate.kind === "section";

/**
 * Where a screen's answer lives before anybody has given one — `true` unless the catalogue says the
 * screen starts off for this role (Q-SET2, `startsOnFor`). The Permissions page reads the same
 * function so a cell and the guard cannot disagree about what "no row" means.
 *
 * Only an editable role can start off: see `startsOnFor` for why `admin` is exempt.
 */
export function surfaceStartsOn(s: Pick<Surface, "startsOnFor">, role: UserRole | null): boolean {
  if (!s.startsOnFor || !role || !(EDITABLE_ROLES as readonly string[]).includes(role)) return true;
  return s.startsOnFor.includes(role);
}

/**
 * The ROLE half of a surface's gate — does this caller's role (as the org may have re-answered it)
 * reach this screen? Deliberately separate from the module half, because the two are known at
 * different times: a role is in the token, and the org's modules arrive from a query.
 *
 * The router guard uses THIS one. It runs before any component mounts, and the modules query may not
 * have resolved yet — `moduleEnabled(null, …)` is `false`, so a guard that also checked modules would
 * bounce a hard refresh of `/loads` to the dashboard for reasons that have nothing to do with
 * permissions. Module entitlement is enforced where it can be known: the sidebar (which has the
 * query) and the API (`requireModule`, which has the org).
 */
export function surfaceGateAllows(s: Gated, role: UserRole | null, sections: SectionClaim | null = null): boolean {
  switch (s.gate.kind) {
    // No role requirement whatsoever — see the SurfaceGate comment for why this is not `staff`.
    case "always":
      return true;
    case "admin":
      return role === "admin";
    // A driver never renders the web sidebar, so this reads as "any signed-in office user". It is
    // written as a role test rather than assumed, because the API will ask the same question.
    case "staff":
      return role != null && role !== "driver";
    case "section":
      return s.gate.level === "manage"
        ? callerCanManage(role, s.gate.section, sections)
        : callerCanView(role, s.gate.section, sections);
    // The role half of "any screen behind it": could this role reach one, section-wise.
    case "directory":
      return s.gate.screens.some((c) => surfaceGateAllows(c, role, sections));
  }
}

/** Both halves — the role gate AND the org's modules. The sidebar uses this one. */
export function canReachSurface(
  s: Gated,
  role: UserRole | null,
  modules: ModuleSet | null,
  sections: SectionClaim | null = null,
): boolean {
  if (s.module && !moduleEnabled(modules, s.module)) return false;
  return surfaceGateAllows(s, role, sections);
}

/**
 * An org's answers, sparse: `role → surface key → allowed` (D-SURF6). A key that is absent is not
 * denied — it is UNCHANGED, and the surface's own gate answers, then its starting default
 * (`surfaceStartsOn`, Q-SET2).
 */
export type SurfaceOverrides = Partial<Record<UserRole, Record<string, boolean>>>;

/** One caller's slice of that: the answers for THEIR role, which is all the client needs. */
export type SurfaceClaim = Record<string, boolean>;

/**
 * The whole question, in the order that makes D-SURF2 true by construction: the SECTION gate first,
 * then the org's answer.
 *
 * The order is the safety argument, not a style choice. A surface may only ever narrow within its
 * section, so an org's `allowed: true` must never lift a role past a section it does not hold — and
 * checking the gate first is what guarantees that, rather than a rule someone has to remember when
 * they add the next layer. S4's per-user answers resolve into `override` before this is called, so
 * this function stays the one place the precedence is written down.
 */
export function surfaceAllowed(
  s: Surface,
  role: UserRole | null,
  sections: SectionClaim | null,
  surfaces: SurfaceClaim | null,
): boolean {
  if (s.gate.kind === "directory") return s.gate.screens.some((c) => surfaceAllowed(c, role, sections, surfaces));
  if (!surfaceGateAllows(s, role, sections)) return false;
  // A detail route is never separately grantable (D-SURF8): denying Loads must also deny the load a
  // bookmark points at, so it answers to its parent's key rather than to one of its own.
  const key = s.parent ?? s.key;
  // No answer falls to the screen's starting default, not to `true` (Q-SET2). This is also what
  // keeps the fail-open in `surfaceClaimFor` safe: an unreadable claim is `{}`, and `{}` now means
  // "as shipped" — which for a screen that starts off is still off.
  return surfaces?.[key] ?? surfaceStartsOn(s, role);
}

