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
  { key: "fuel.log", label: "Fuel Log", path: "/fuel-log", group: "fuel", gate: ALWAYS },
  { key: "fuel.transactions", label: "Transactions", path: "/transactions", group: "fuel", gate: section("fuel") },
  { key: "fuel.rejections", label: "Rejections", path: "/rejections", group: "fuel", gate: section("fuel") },
  // EFS card inventory + control. Read-only until the write entitlement is confirmed; the page
  // itself explains that, so the catalogue entry does not need to know.
  { key: "fuel.cards", label: "Cards", path: "/fuel-cards", group: "fuel", gate: section("fuel") },
  { key: "fuel.import", label: "Import", path: "/import", group: "fuel", gate: manage("fuel") },
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
   * ⚠ `staff`, not `section("hazmat")`, and that is a FAITHFUL transcription of today rather than an
   * endorsement. Q-SURF2 has it: the `hazmat` section gates RLS and gates the review COUNT in
   * `AppShell.vue`, but not these entries — so a role with `hazmat: "none"` sees "Hazmat review"
   * permanently badge-less and can open the queue. Changing it here would be a narrowing for any org
   * holding the module without the section, which S1 is explicitly not the place for: this step must
   * not move a single role's access. Q-SURF2 decides it, and it is a one-line edit when it does.
   */
  { key: "safety.placard-calculator", label: "Placard calculator", path: "/hazmat/calculator", group: "safety", gate: STAFF, module: "hazmatguard" },
  { key: "safety.hazmat-review", label: "Hazmat review", path: "/hazmat/review", group: "safety", gate: STAFF, module: "hazmatguard", badge: "hazmatReview" },

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

  // ── detail routes: never in the sidebar, never separately grantable (D-SURF8) ─────────────────
  // They carry no `label` in the nav because they carry no nav entry; they exist so S2's guard can
  // resolve `/loads/:id` to the permission its list surface already states. `parent` is what makes
  // "deny Loads" also deny the load a bookmark points at.
  { key: "dispatch.loads.detail", label: "Load", path: "/loads/:id", group: "dispatch", gate: section("dispatch"), module: "dispatch", parent: "dispatch.loads" },
  { key: "fleet.drivers.detail", label: "Driver", path: "/drivers/:id", group: "fleet", gate: section("roster"), parent: "fleet.drivers" },
  { key: "safety.driver-qualification.detail", label: "Driver Qualification", path: "/compliance/:id", group: "safety", gate: section("roster"), parent: "safety.driver-qualification" },
  { key: "fleet.vehicles.detail", label: "Vehicle", path: "/vehicles/:id", group: "fleet", gate: section("equipment"), parent: "fleet.vehicles" },
  { key: "fuel.cards.detail", label: "Fuel Card", path: "/fuel-cards/:id", group: "fuel", gate: section("fuel"), parent: "fuel.cards" },
  { key: "recruitment.applicants.detail", label: "Applicant", path: "/recruitment/:id", group: "recruitment", gate: section("recruitment"), parent: "recruitment.applicants" },
  { key: "maintenance.inspections.detail", label: "Annual inspection", path: "/shop/inspections/:id", group: "maintenance", gate: section("maintenance"), parent: "maintenance.inspections" },
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

/** Does this caller pass the surface's gate, given their role, overrides and the org's modules? */
export function canReachSurface(
  s: Surface,
  role: UserRole | null,
  modules: ModuleSet | null,
  sections: SectionClaim | null = null,
): boolean {
  if (s.module && !moduleEnabled(modules, s.module)) return false;
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

/** The surface a declared route path belongs to, or undefined if the route is not catalogued. */
export function surfaceForPath(path: string): Surface | undefined {
  return SURFACES.find((s) => s.path === path);
}
