import {
  ADMIN,
  ALWAYS,
  STAFF,
  manage,
  section,
  type Surface,
  type SurfaceGroup,
} from "./surfaces.js";

/**
 * THE CATALOGUE — every screen this product has, and which permission each one needs
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S1, D-SURF3).
 *
 * ── WHY THIS IS A SEPARATE FILE FROM `surfaces.ts`, AND WHERE THE SEAM IS ─────────────────────
 * Split out on 2026-09-18 (Q-HM8) when the combined file reached **500 of its 500 lines** — B4 had
 * fitted inside the budget by cutting its own comments back, which works exactly once and leaves
 * the next person to add a screen with no room and less context. The alternative on offer was a
 * waiver, and `lint:filesize` names that a deliberate, reviewable act for a reason.
 *
 * The seam is the one `hiringSteps.ts` / `hiringChecklist.ts` took at its own 450 warning, and it
 * is a real one rather than wherever the line count fell: **this file is the DATA** — which screens
 * exist, what each is called, where it lives, what it needs — and its neighbour is the TYPES and
 * the LOGIC that answers *may this caller see it*. The dependency runs one way, catalogue →
 * surfaces, so there is no cycle and the gate functions can be read without scrolling past 280
 * entries.
 *
 * ⚠ **A key is the primary key an override is stored against (S3/S4).** `maintenance.repair-spend`
 * below carries the measurement: renaming one silently resets every org's and every user's answer
 * about that screen. Nothing in this file is safe to rename for tidiness.
 *
 * ⚠ **`scripts/check-surfaces.mjs` PARSES this file** rather than importing it — for the reason
 * every gate in this repo does, that a gate needing the workspace built cannot run before the
 * build. Its `CATALOGUE` constant names this path, and its parser finds the `SURFACES` declaration
 * by matching that line and reads to the array's closing bracket. Moving either half without the
 * other breaks the gate loudly, which is the intended failure.
 *
 * ⚠ **And prose here must not quote that declaration verbatim.** This comment did, while the split
 * was being made, and the parser matched the COMMENT: it then read to the next `];`, which is the
 * end of `SURFACE_GROUPS` above, and reported nine surfaces where there are fifty-seven. The gate
 * caught it immediately — *"parser or literal shape changed"* — but a paraphrase costs nothing and
 * the next person to document this file should know why it reads the way it does.
 */

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
  /**
   * The Findings inbox (C7b). ⚠ THE KEY STAYS `fuel.exceptions` AND THAT IS NOT AN OVERSIGHT.
   *
   * A surface key is an IDENTITY and it is persisted: `user_surface_access` and
   * `org_role_surface_access` store it, and production holds a real per-user grant on this one.
   * Renaming it to `fuel.findings` would not migrate that grant, it would orphan it — somebody's
   * explicit access would silently stop applying, which is the quietest possible permissions bug.
   * The label and the path are what a reader sees; the key is what the database remembers.
   *
   * The gate stays `section("fuel")` because Q-FUI1 ruled the inbox LIVES in Fuel. The safety half is
   * added per ROW by the API rather than by widening this gate: every role that holds `safety` also
   * holds `fuel: "view"`, so nobody is hidden from a queue they can work, and a caller without
   * `safety` simply has no theft cases in their list rather than being refused the page.
   */
  { key: "fuel.exceptions", label: "Findings", path: "/findings", group: "fuel", gate: section("fuel") },
  { key: "fuel.ifta", label: "IFTA", path: "/ifta", group: "fuel", gate: section("fuel") },

  // ── dispatch ──────────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ THE LIVE MAP IS NOT IN THIS CATALOGUE ANY MORE (D-DR24, 2026-09-16). It was the first entry in
   * this group — `/live-map`, the screen a dispatcher started their shift on. The owner ruled the two
   * live maps into one and kept the Dashboard's Dispatch tab, so the page, the route and this
   * sidebar entry went together: a nav link to a deleted route is the exact defect `lint:surfaces`
   * exists to catch, and leaving the entry pointed at `/?tab=dispatch` would have put a tab of the
   * dashboard in the sidebar as if it were a page of its own.
   *
   * The widget catalogue still carries `dispatch.live-map` — same key, different catalogue, and that
   * is not a leftover: the key names the SURFACE ENTITLEMENT, which is what the dashboard widget
   * gates on. Its gate and module live in `dashboardWidgets.ts` and say exactly what this entry said.
   */
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
  // ⚠ ONE recruitment entry since B4 (D-HUI8), where there were three: screening readiness and the
  // inquiry queue are children of this one now, in the NON-NAV block below. Keys unchanged.
  { key: "recruitment.applicants", label: "Applicants", path: "/recruitment", group: "recruitment", gate: section("recruitment") },

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
  // G7 removed three of the four accounting surfaces: transaction-grain browsing (Money in & out),
  // the per-unit fixed-cost schedule (nothing allocates any more, D-FLEET8) and the Books check
  // page (the close still runs; only the page went). What is left is the report itself.
  { key: "finance.fleet-report", label: "Fleet report", path: "/fleet-report", group: "finance", gate: section("accounting") },
  // "Revenue & margin" until R7 of the fleet report's UI plan (2026-09-04): its dispatcher table
  // moved onto the fleet report and its per-truck margin was retired (D-FLEET1). What is left is
  // the invoice lookup, so the page is named for the one thing it does.
  { key: "finance.billing", label: "Invoices", path: "/billing", group: "finance", gate: section("billing") },

  // ── maintenance ───────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ THE KEY SAYS `repair-spend` AND THE SCREEN IS NOW THE SHOP'S HOME (INVENTORY-PLAN.md I4).
   *
   * `/shop` was the repair-spend ledger and is the section home from I4 on; the ledger moved down to
   * `/shop/repair-spend`. The obvious tidy — renaming the key to `maintenance.shop` — is exactly what
   * must not happen, and not on style grounds: **the key IS the primary key an override is stored
   * against** (S3/S4), so renaming it silently resets every org's and every user's answer about this
   * screen to the shipped default. Measured in production 2026-09-09, before the relabel: one live
   * `user_surface_access` row denies `maintenance.repair-spend` to one member. A rename would have
   * granted them the screen back with nothing in the product recording that it had happened.
   *
   * The consequence of KEEPING it is real too and is smaller: that member is now denied the shop
   * home rather than one report. The ledger below carries `parent: "maintenance.repair-spend"`, so
   * the half of their denial that already existed keeps meaning what it meant.
   */
  { key: "maintenance.repair-spend", label: "Shop", path: "/shop", group: "maintenance", gate: section("maintenance") },
  { key: "maintenance.parts", label: "Parts", path: "/shop/inventory", group: "maintenance", gate: section("maintenance") },
  /**
   * The assets (INVENTORY-PLAN.md I8). Its own nav row and not a tab on Parts, because §2.1's seam
   * is two questions: stock asks "how many and where" about a shelf, an asset asks "which one and
   * where was it before" about a thing. I4's ruling fixes this group at six rows — Shop, Parts,
   * Assets, Units, Annual inspections, Inspectors — and this is the fifth; Units arrives at I9.
   */
  { key: "maintenance.assets", label: "Assets", path: "/shop/assets", group: "maintenance", gate: section("maintenance") },
  /**
   * Units (I9) — the sixth and last row of the group I4's ruling fixed at six. It is the assets read
   * from the other end: Assets answers "where is A-0412", Units answers "what is truck 654 missing".
   */
  { key: "maintenance.units", label: "Units", path: "/shop/units", group: "maintenance", gate: section("maintenance") },
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
  /**
   * The board's two other tabs (D-HUI8, B4). Non-nav, parented on the board, keys unchanged.
   *
   * U1/D-UI1 gave both a nav entry in 2026-08-20's P0b incident, when they were reachable only from
   * two buttons and a recruiter arriving from a notification had no way back. This does NOT
   * reintroduce it: the tab strip is on all three pages and every URL still resolves.
   * ⚠ A `parent` makes them answer to the board's key (D-SURF8), so a separate denial of either
   * would become a denial of the board. Measured on production first, 2026-09-18: both override
   * tables hold ZERO rows for any `recruitment.*` key, so nothing stored is reinterpreted.
   */
  { key: "recruitment.screening", label: "Screening readiness", path: "/recruitment/screening", group: "recruitment", gate: section("recruitment"), parent: "recruitment.applicants" },
  { key: "recruitment.inquiries", label: "Safety-history inquiries", path: "/recruitment/inquiries", group: "recruitment", gate: section("recruitment"), parent: "recruitment.applicants" },
  { key: "maintenance.inspections.detail", label: "Annual inspection", path: "/shop/inspections/:id", group: "maintenance", gate: section("maintenance"), parent: "maintenance.inspections" },
  { key: "maintenance.parts.detail", label: "Part", path: "/shop/inventory/:id", group: "maintenance", gate: section("maintenance"), parent: "maintenance.parts" },
  { key: "maintenance.assets.detail", label: "Asset", path: "/shop/assets/:id", group: "maintenance", gate: section("maintenance"), parent: "maintenance.assets" },
  { key: "maintenance.units.detail", label: "Unit", path: "/shop/units/:kind/:id", group: "maintenance", gate: section("maintenance"), parent: "maintenance.units" },
  /**
   * The shelf count (I5 PR 2b). `parent: "maintenance.parts"` rather than a key of its own, and the
   * choice is a permission argument: a count is a walk of the STOCK, so an org that has taken Parts
   * away from a role has taken the thing a count is about — and D-INV19 makes the same session shape
   * serve I9's unit check, which will point at Units for the same reason.
   */
  { key: "maintenance.parts.count", label: "Count", path: "/shop/count/:sessionId", group: "maintenance", gate: section("maintenance"), parent: "maintenance.parts" },
  /**
   * The scan surface (I6). Non-nav, and its parent is the SHOP HOME rather than Parts.
   *
   * The count above parents to Parts because a count is a walk of the stock, and an org that has
   * taken Parts away from a role has taken away the thing a count is about. A scan is not that: one
   * pull of a trigger resolves a stock line, an asset or a supplier barcode without the person
   * holding the scanner knowing or needing to know which (D-INV7), so parenting it to either half
   * would deny it for the wrong reason — a role allowed Assets but not Parts would lose the ability
   * to scan an ASSET tag. The shop home is the honest parent: it is the door this screen is behind,
   * and a role denied the shop entirely is denied its scanner too.
   *
   * ⚠ That parent is `maintenance.repair-spend`, whose key is a historical spelling of the shop home
   * and which carries a live production denial (see the note on the nav row above). Inheriting it is
   * deliberate: the member who cannot open the shop cannot open its scanner, which is the same
   * answer they already have about every other screen in the section.
   */
  { key: "maintenance.scan", label: "Scan", path: "/shop/scan", group: "maintenance", gate: section("maintenance"), parent: "maintenance.repair-spend" },
  /**
   * The label screen (I10). Non-nav, and it parents to the shop home for the SAME argument the scan
   * above makes: one sheet can carry shelf labels and asset labels together, so parenting it to
   * either half would deny it for the wrong reason — a role allowed Assets but not Parts would lose
   * the ability to print an asset's tag. The maintenance group is fixed at six rows by I4's ruling
   * and this is not one of them; it is reached from Parts and from Assets.
   */
  { key: "maintenance.labels", label: "Labels", path: "/shop/labels", group: "maintenance", gate: section("maintenance"), parent: "maintenance.repair-spend" },
  /**
   * The repair-spend ledger, which used to BE `/shop` (I4).
   *
   * It is a child rather than a nav entry of its own for two reasons that point the same way. The
   * maintenance group is fixed at six entries by I4's ruling and this is not one of them — it is one
   * `StatCard` on the home and the page behind that card. And it must answer to
   * `maintenance.repair-spend`, because that key already carries a production denial about THIS
   * page: given a key of its own the denial would stop reaching the ledger the day the home took
   * the key over. D-SURF8's inheritance is what keeps that answer where it was pointed.
   */
  { key: "maintenance.repair-spend.ledger", label: "Repair spend", path: "/shop/repair-spend", group: "maintenance", gate: section("maintenance"), parent: "maintenance.repair-spend" },

  // ── non-nav screens that already state a section, transcribed (no behaviour change) ───────────
  // `dispatch.loads.new` (`/loads/new`) left in LR6 (LOADS-MIRROR-PLAN.md, Q-LMR7): loads come from
  // McLeod only, so there is no create screen to grant. No stored access row named it (checked in
  // production 2026-09-24), and an unknown stored key grants and denies nothing anyway (0296).
  { key: "admin.settings.data", label: "Data & sync", path: "/settings/data", group: "admin", gate: manage("settings"), parent: "admin.settings" },
  /**
   * ⚠ `manage("settings")` and not `recruitment`: this screen decides the text an applicant legally
   * signs. A recruiter processing applications has no business rewriting a federal authorization,
   * and the blast radius of a bad edit is every signature taken afterwards. The API's READ is
   * `recruitment view` for the same reason in reverse — a recruiter does need to find out that an
   * unpublished instrument is what is stopping every applicant they invite.
   */
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

/** The surface a declared route path belongs to, or undefined if the route is not catalogued. */
export function surfaceForPath(path: string): Surface | undefined {
  return SURFACES.find((s) => s.path === path);
}
