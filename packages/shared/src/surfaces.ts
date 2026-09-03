import type { AppSection, SectionAccess, SectionClaim } from "./auth.js";
import type { UserRole } from "./constants.js";
import { callerCanView, callerCanManage } from "./auth.js";
import type { ModuleKey, ModuleSet } from "./entitlements.js";
import { moduleEnabled } from "./entitlements.js";

/**
 * The surface catalogue — one home for "which permission does this screen need"
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S1, D-SURF3).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 * That fact used to live in exactly one place, `apps/web/src/lib/nav.ts`, written 37 times as a
 * `show:` expression. One place sounds correct, and it was — right up until anything else needed the
 * same answer. Measured on 2026-09-02: of the 31 sidebar entries gated on a section, **exactly 3**
 * had a route that gated on anything, so 28 URLs stayed reachable for a role whose menu entry was
 * hidden. `/settings` had the mismatch the other way (gated at `manage` while its entry asked
 * `view`), which meant the one role it was added for — the auditor — was bounced by it for as long
 * as both halves existed.
 *
 * Neither was a bug anybody wrote. They are what happens when the sidebar holds the answer and the
 * router has to remember it. So the answer moves here, and the sidebar (S1), the router guard (S2)
 * and the per-role/per-user overrides (S3/S4) all read it.
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
  | { kind: "admin" };

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
  /** Live count rendered beside the entry. The value is injected per request, not stored here. */
  badge?: "hazmatReview" | "messagesUnread";
}

export interface SurfaceGroup {
  key: string;
  /** `null` renders ungrouped, above every labelled group — Dashboard and Ask AI. */
  label: string | null;
}

/** Group order IS sidebar order. */
export const SURFACE_GROUPS: readonly SurfaceGroup[] = [
  { key: "top", label: null },
  { key: "fuel", label: "Fuel" },
  { key: "dispatch", label: "Dispatch" },
  { key: "safety", label: "Safety" },
  { key: "recruitment", label: "Recruitment" },
  { key: "fleet", label: "Fleet" },
  { key: "finance", label: "Finance" },
  { key: "maintenance", label: "Maintenance" },
  { key: "admin", label: "Admin" },
];

const section = (s: AppSection, level: SectionAccess = "view"): SurfaceGate => ({ kind: "section", section: s, level });
const manage = (s: AppSection): SurfaceGate => section(s, "manage");
const ALWAYS: SurfaceGate = { kind: "always" };
const STAFF: SurfaceGate = { kind: "staff" };
const ADMIN: SurfaceGate = { kind: "admin" };

/**
 * Array order IS item order within a group. Every `path` is a real route — `lint:surfaces` checks
 * each one against the committed route snapshot, which is generated from the live router.
 */
export const SURFACES: readonly Surface[] = [
  // ── top (ungrouped) ───────────────────────────────────────────────────────────────────────────
  { key: "dashboard", label: "Dashboard", path: "/", group: "top", gate: ALWAYS },
  { key: "ask-ai", label: "Ask AI", path: "/ask", group: "top", gate: STAFF },

  // ── fuel ──────────────────────────────────────────────────────────────────────────────────────
  /**
   * FUEL-C2: `fuel.transactions` (`/transactions`) and `fuel.rejections` (`/rejections`) were here
   * until 2026-09-02 and are now TABS of the Fuel Log, so they are no longer separately grantable —
   * a screen an org cannot navigate to is not a permission an admin should be offered.
   *
   * Rows an org already wrote against the two retired keys stay in `org_role_surface_access` and
   * are inert — 0296's own note: a key the catalogue does not have matches no screen, and grants
   * and denies nothing.
   *
   * ⚠ `section("fuel")`, since 2026-09-03 (owner ruling, D-SURF10): a page that sits in a section's
   * group follows that section. This was `always` — the one fuel page every office role could open
   * whatever the matrix said — which is why an org that took `fuel` away from a role still saw
   * "Fuel Log" in that role's sidebar, and why the page had to gate its own absorbed tabs on
   * `canView("fuel")`. It still does, and that check is now redundant rather than load-bearing. This
   * is a NARROWING for `recruiter` and `technician`, whose shipped `fuel` is `none`; both snapshots
   * record it.
   */
  { key: "fuel.log", label: "Fuel Log", path: "/fuel-log", group: "fuel", gate: section("fuel") },
  // EFS card inventory + control. Read-only until the write entitlement is confirmed; the page
  // itself explains that, so the catalogue entry does not need to know.
  { key: "fuel.cards", label: "Cards", path: "/fuel-cards", group: "fuel", gate: section("fuel") },
  // `fuel.import` (`/import`) was here until FUEL-C4 (2026-09-03). Its three capabilities are drawers
  // now — the EFS backfill on Fuel Log, prices and locations on Truck Stops, Repair on Settings →
  // Data & sync — so there is no screen left to grant, and each drawer carries the `manage` check
  // this entry used to carry at the route. Rows written against the retired key are inert (0296).
  // D-FX8: five of its seven tabs are spend analytics; reconciliation is one of them.
  { key: "fuel.spend", label: "Fuel Spend", path: "/fuel-spend", group: "fuel", gate: manage("fuel") },
  // The ledger is a READ surface for anyone who can see fuel — a controller checking what was
  // recovered does not need the permission to upload a statement. Moving a finding is gated at the
  // route, not here.
  { key: "fuel.exceptions", label: "Exceptions", path: "/fuel-spend/exceptions", group: "fuel", gate: section("fuel") },
  { key: "fuel.ifta", label: "IFTA", path: "/ifta", group: "fuel", gate: section("fuel") },

  // ── dispatch ──────────────────────────────────────────────────────────────────────────────────
  { key: "dispatch.loads", label: "Loads", path: "/loads", group: "dispatch", gate: section("dispatch"), module: "dispatch" },
  // Phase 7 (D-PM4): the dispatch inbox — participation-scoped, module-gated, badge = unread.
  { key: "dispatch.messages", label: "Messages", path: "/messages", group: "dispatch", gate: section("dispatch"), module: "messages", badge: "messagesUnread" },
  { key: "dispatch.assignments", label: "Assignments", path: "/assignments", group: "dispatch", gate: section("dispatch"), module: "dispatch" },
  { key: "dispatch.fuel-planning", label: "Fuel Planning", path: "/fuel-planning", group: "dispatch", gate: manage("dispatch") },
  { key: "dispatch.truck-stops", label: "Truck Stops", path: "/truck-stops", group: "dispatch", gate: section("dispatch") },

  // ── safety ────────────────────────────────────────────────────────────────────────────────────
  { key: "safety.alerts", label: "Alerts", path: "/anomalies", group: "safety", gate: section("safety") },
  { key: "safety.driver-performance", label: "Driver Performance", path: "/driver-performance", group: "safety", gate: section("safety") },
  { key: "safety.idling", label: "Idling", path: "/idling", group: "safety", gate: section("safety") },
  /**
   * The driver qualification file (§391.51) — certifications, the DQF event history, and the scans
   * behind both. `roster` and not `safety`: the §391.51 file is a fact about a PERSON, and that gate
   * was `fleet` until the D-ROS12 split. Named for what it is rather than "Compliance", which said
   * nothing; `/compliance` stays the path so nobody's bookmark breaks.
   */
  { key: "safety.driver-qualification", label: "Driver Qualification", path: "/compliance", group: "safety", gate: section("roster") },
  /**
   * TWO hazmat entries (D-H15, owner decision 2026-08-30) — the hub they used to share is gone.
   * H-C4 cut five items to one because four duplicated Loads, Trailers and Compliance; that retires
   * the DUPLICATES, not the surfaces. These two duplicate nothing: the calculator is a tool with no
   * other home, and the review queue is a §172 work queue for a tighter role set than dispatch (D6).
   *
   * `section("hazmat")` AND the module, since 2026-09-03 — Q-SURF2 answered (a), under the same
   * ruling as Fuel Log (D-SURF10). Until then these were `staff`: the `hazmat` section gated RLS and
   * gated the review COUNT in `AppShell.vue`, but not the entries themselves — so a role with
   * `hazmat: "none"` saw "Hazmat review" permanently badge-less and could open the queue, and the
   * HazmatGuard column on the permissions page moved nothing a person could see. This is a NARROWING
   * for `recruiter`, `accountant` and `technician`, whose shipped `hazmat` is `none`; the review
   * queue's own write stays with HAZMAT_REVIEW_ROLES (D6), which a section grant never widens.
   */
  { key: "safety.placard-calculator", label: "Placard calculator", path: "/hazmat/calculator", group: "safety", gate: section("hazmat"), module: "hazmatguard" },
  { key: "safety.hazmat-review", label: "Hazmat review", path: "/hazmat/review", group: "safety", gate: section("hazmat"), module: "hazmatguard", badge: "hazmatReview" },

  // ── recruitment ───────────────────────────────────────────────────────────────────────────────
  // The hiring half of §391, and its OWN section — not a corner of Fleet. Gating it on `fleet` (how
  // it first shipped) let a dispatcher read every driver's former employers; §391.53(a)(1) puts that
  // file with the people making the hiring decision.
  { key: "recruitment.applicants", label: "Applicants", path: "/recruitment", group: "recruitment", gate: section("recruitment") },
  // U1/D-UI1: both routes were REGISTERED on 2026-08-20 to close a P0b incident (the URLs fell
  // through to nothing) and still had no nav entry, so they were reachable only from two buttons on
  // the Applicants page. A recruiter arriving from a notification had no way back.
  { key: "recruitment.screening", label: "Screening readiness", path: "/recruitment/screening", group: "recruitment", gate: section("recruitment") },
  { key: "recruitment.inquiries", label: "Safety-history inquiries", path: "/recruitment/inquiries", group: "recruitment", gate: section("recruitment") },

  // ── fleet ─────────────────────────────────────────────────────────────────────────────────────
  // ⚠ ONE group, TWO sections since the D-ROS12 split, deliberately. "Fleet" is where an operator
  // looks for both the people and the trucks, so the grouping stays; each item asks the question it
  // actually means. A recruiter has `equipment: none` and sees this group containing Drivers alone.
  { key: "fleet.vehicles", label: "Vehicles", path: "/vehicles", group: "fleet", gate: section("equipment") },
  { key: "fleet.trailers", label: "Trailers", path: "/trailers", group: "fleet", gate: section("equipment") },
  { key: "fleet.drivers", label: "Drivers", path: "/drivers", group: "fleet", gate: section("roster") },
  // A reading taken off a truck, corrected against a truck's history — equipment, not roster.
  { key: "fleet.odometer", label: "Odometer", path: "/odometer", group: "fleet", gate: section("equipment") },

  // ── finance ───────────────────────────────────────────────────────────────────────────────────
  // The money sections (P5, D-SEP7): visible only to the roles the matrix names — the accountant,
  // the admin, the auditor. Ops roles see nothing here, by ruling.
  { key: "finance.accounting", label: "Money in & out", path: "/accounting", group: "finance", gate: section("accounting") },
  { key: "finance.cpm", label: "Cost per mile", path: "/cpm", group: "finance", gate: section("accounting") },
  { key: "finance.cost-schedule", label: "Truck fixed costs", path: "/cost-schedule", group: "finance", gate: section("accounting") },
  { key: "finance.books-check", label: "Books check", path: "/books-check", group: "finance", gate: section("accounting") },
  { key: "finance.billing", label: "Revenue & margin", path: "/billing", group: "finance", gate: section("billing") },

  // ── maintenance ───────────────────────────────────────────────────────────────────────────────
  { key: "maintenance.repair-spend", label: "Repair spend", path: "/shop", group: "maintenance", gate: section("maintenance") },
  { key: "maintenance.inspections", label: "Annual inspections", path: "/shop/inspections", group: "maintenance", gate: section("maintenance") },
  { key: "maintenance.inspectors", label: "Inspectors", path: "/shop/inspectors", group: "maintenance", gate: section("maintenance") },

  // ── admin ─────────────────────────────────────────────────────────────────────────────────────
  // Settings = org config (its route asks `view` since Q-SURF5, so the auditor's audit-log card is
  // reachable); Users = admin only. Department roles get neither.
  { key: "admin.settings", label: "Settings", path: "/settings", group: "admin", gate: section("settings") },
  { key: "admin.users", label: "Users", path: "/settings/users", group: "admin", gate: ADMIN },

  // ── NON-NAV surfaces: never in the sidebar, never separately grantable (D-SURF8) ──────────────
  // A `parent` means "this screen is reached from another one and shares its grant". They exist so
  // the router guard can resolve `/loads/:id` — or `/settings/data` — to a permission, which is what
  // makes "deny Loads" also deny the load a bookmark points at. They carry their OWN gate, because a
  // child is not always the parent's level: `/settings` asks `view` and `/settings/data` asks
  // `manage`, and inheriting the gate rather than stating it would quietly widen the second.
  { key: "dispatch.loads.detail", label: "Load", path: "/loads/:id", group: "dispatch", gate: section("dispatch"), module: "dispatch", parent: "dispatch.loads" },
  { key: "fleet.drivers.detail", label: "Driver", path: "/drivers/:id", group: "fleet", gate: section("roster"), parent: "fleet.drivers" },
  { key: "safety.driver-qualification.detail", label: "Driver Qualification", path: "/compliance/:id", group: "safety", gate: section("roster"), parent: "safety.driver-qualification" },
  { key: "fleet.vehicles.detail", label: "Vehicle", path: "/vehicles/:id", group: "fleet", gate: section("equipment"), parent: "fleet.vehicles" },
  { key: "fuel.cards.detail", label: "Fuel Card", path: "/fuel-cards/:id", group: "fuel", gate: section("fuel"), parent: "fuel.cards" },
  { key: "recruitment.applicants.detail", label: "Applicant", path: "/recruitment/:id", group: "recruitment", gate: section("recruitment"), parent: "recruitment.applicants" },
  { key: "maintenance.inspections.detail", label: "Annual inspection", path: "/shop/inspections/:id", group: "maintenance", gate: section("maintenance"), parent: "maintenance.inspections" },

  // ── non-nav screens that already state a section, transcribed (no behaviour change) ───────────
  { key: "dispatch.loads.new", label: "New Load", path: "/loads/new", group: "dispatch", gate: manage("dispatch"), module: "dispatch", parent: "dispatch.loads" },
  { key: "admin.settings.data", label: "Data & sync", path: "/settings/data", group: "admin", gate: manage("settings"), parent: "admin.settings" },
  // `roster` and not `settings`: this console decides what DRIVERS see, and `driverAppSettings.ts`
  // gates on rolesThatManage("roster"). The card, the route and the endpoint ask one question —
  // before R0 all three asked the same global boolean and agreed by accident rather than by design.
  { key: "admin.settings.driver-app", label: "Driver App", path: "/settings/driver-app", group: "admin", gate: manage("roster"), parent: "admin.settings" },

  /**
   * ── the reporting and detection-health screens, which had NO route gate at all ────────────────
   * Reached from the "Reports & detection health" cards on the settings page, which show on
   * `session.can("settings") || session.readOnly`. That expression resolves to exactly
   * [admin, fleet_manager, auditor] — which IS `rolesThatCanView("settings")`, because the auditor is
   * the only `readOnly` role and the only one holding `settings: "view"` without `manage`. So this is
   * a transcription of the card's own gate, not a new opinion about who may read a report.
   *
   * ⚠ It IS a narrowing at the URL: today any staff role can type `/reports` and get the page. That
   * is the 28-route defect wearing different clothes — the card is hidden and the address still
   * works — and closing it is what this step is for.
   */
  { key: "admin.reports", label: "Reports", path: "/reports", group: "admin", gate: section("settings"), parent: "admin.settings" },
  { key: "admin.coverage", label: "Detection coverage", path: "/coverage", group: "admin", gate: section("settings"), parent: "admin.settings" },
  { key: "admin.reefer-coverage", label: "Reefer coverage", path: "/reefer-coverage", group: "admin", gate: section("settings"), parent: "admin.settings" },
  { key: "admin.recall-audit", label: "Recall audit", path: "/recall-audit", group: "admin", gate: section("settings"), parent: "admin.settings" },

  /**
   * The hazmat evidence workspace — reached from the dispatch load and from the review queue, never
   * from a board of its own. Ungated at the route today; it takes the same gate as the review queue
   * it is opened from, which under Q-SURF2 is still `staff` + the module rather than the `hazmat`
   * section. ⚠ Adding the module IS a narrowing for an org that never bought HazmatGuard — the API
   * already refuses those calls via `requireModule`, so this stops a page mounting only to 403.
   */
  { key: "safety.hazmat-load.detail", label: "Hazmat Load", path: "/hazmat/loads/:id", group: "safety", gate: section("hazmat"), module: "hazmatguard", parent: "safety.hazmat-review" },
];

/** The surfaces that render in the sidebar — everything except the detail routes (D-SURF8). */
export const NAV_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.parent === undefined);

/**
 * Editable is DERIVED, never stored (Q-SURF3, owner's ruling 2026-09-02). A surface is an org's to
 * configure exactly when its gate is a SECTION gate, because a section is the only thing the
 * permission matrix can move. Writing an `editable: false` beside a `staff` gate that already says
 * so would be a second home for one fact — the failure D-SURF3 names.
 */
export const isEditableSurface = (s: Surface): boolean => s.gate.kind === "section";

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
export function surfaceGateAllows(s: Surface, role: UserRole | null, sections: SectionClaim | null = null): boolean {
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
  }
}

/** Both halves — the role gate AND the org's modules. The sidebar uses this one. */
export function canReachSurface(
  s: Surface,
  role: UserRole | null,
  modules: ModuleSet | null,
  sections: SectionClaim | null = null,
): boolean {
  if (s.module && !moduleEnabled(modules, s.module)) return false;
  return surfaceGateAllows(s, role, sections);
}

/**
 * An org's answers, sparse: `role → surface key → allowed` (D-SURF6). A key that is absent is not
 * denied — it is UNCHANGED, and the surface's own gate answers.
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
  if (!surfaceGateAllows(s, role, sections)) return false;
  // A detail route is never separately grantable (D-SURF8): denying Loads must also deny the load a
  // bookmark points at, so it answers to its parent's key rather than to one of its own.
  const key = s.parent ?? s.key;
  return surfaces?.[key] ?? true;
}

/** The surface a declared route path belongs to, or undefined if the route is not catalogued. */
export function surfaceForPath(path: string): Surface | undefined {
  return SURFACES.find((s) => s.path === path);
}
