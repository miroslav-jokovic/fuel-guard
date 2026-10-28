import type { RouteRecordRaw } from "vue-router";

/**
 * The maintenance section — the shop (INVENTORY-PLAN.md step I4, D-S360-7).
 *
 * ── WHY THESE ROUTES WERE IN `finance.ts` AND ARE NOT ANY MORE ─────────────────────────────────
 * The §396.17 register and the repair-spend ledger were declared beside the fleet report because
 * maintenance arrived as a ledger family: at the time the only thing the section held was a filtered
 * view of what finance had already booked. That stopped being true at I2, when the module gained
 * four tables of its own and stopped being a projection of anybody else's. The routes move here so
 * the file a URL is declared in names the module that owns it — the same reason
 * `router/index.ts` composes one file per product area at all.
 *
 * ── THE SECTION LIVES AT `/shop`, NOT AT `/maintenance` ───────────────────────────────────────
 * `/maintenance` is G1's dead-end page, shown when the API is down, and it took that URL and route
 * name long before this section existed (`routes/system.ts`). `/shop` is the program plan's §6 Q7
 * fallback and is what the shop calls itself anyway.
 *
 * ── AND `/shop` IS THE HOME, NOT THE LEDGER, FROM I4 ──────────────────────────────────────────
 * It rendered `MaintenanceSpendPage` until I4. The ledger is one `StatCard` on the home now and the
 * page behind that card, at `/shop/repair-spend`. The SURFACE key stayed `maintenance.repair-spend`
 * for both — see the reasoning in `packages/shared/src/surfaceCatalogue.ts`, which is a permission argument
 * and not a naming one.
 *
 * Routes carry `requiresAuth` only, per the house rule: the section question is answered once in
 * `SURFACES` and read by the guard (D-SURF3), and the API refuses the wrong role regardless.
 */
export const maintenanceRoutes: RouteRecordRaw[] = [
  {
    path: "/shop",
    name: "shop",
    component: () => import("@/pages/MaintenanceHomePage.vue"),
    meta: { requiresAuth: true, title: "Shop" },
  },
  {
    path: "/shop/repair-spend",
    name: "repair-spend",
    component: () => import("@/pages/MaintenanceSpendPage.vue"),
    meta: { requiresAuth: true, title: "Repair bills", parent: "/shop" },
  },
  /**
   * FleetPal's open work orders and open defects (FLEET-MANAGER-HOME-PLAN Q-FM6 (a)) — the lists
   * behind the Shop card's figures and the shop home's repair tiles. Read-only: the repair is worked
   * in FleetPal (D-INV10).
   */
  {
    path: "/shop/work-orders",
    name: "work-orders",
    component: () => import("@/pages/WorkOrdersPage.vue"),
    meta: { requiresAuth: true, title: "Open work orders", parent: "/shop" },
  },
  /**
   * Roadside repairs due (INSPECTION-CHALLENGE-PLAN IC11 B2b, Q-IC16 (a)): the technician's door to the
   * 396.9(d) repair record, which the safety-gated inspection page is not. Opened by the Shop home's section
   * and by the `roadside_repair_due` alert.
   */
  {
    path: "/shop/roadside-repairs",
    name: "roadside-repairs",
    component: () => import("@/pages/RoadsideRepairsPage.vue"),
    meta: { requiresAuth: true, title: "Roadside repairs due", parent: "/shop" },
  },
  {
    path: "/shop/defects",
    name: "defects",
    component: () => import("@/pages/DefectsPage.vue"),
    meta: { requiresAuth: true, title: "Open defects", parent: "/shop" },
  },
  {
    path: "/shop/inventory",
    name: "parts",
    component: () => import("@/pages/PartsPage.vue"),
    meta: { requiresAuth: true, title: "Parts", parent: "/shop" },
  },
  /**
   * The assets (I8). A separate address from `/shop/inventory` rather than a tab on it: §2.1's seam
   * is two different questions about two different kinds of row, and one screen with a toggle is how
   * the driver page grew six tabs.
   */
  {
    path: "/shop/assets",
    name: "assets",
    component: () => import("@/pages/AssetsPage.vue"),
    meta: { requiresAuth: true, title: "Equipment", parent: "/shop/units" },
  },
  {
    path: "/shop/assets/:id",
    name: "asset",
    component: () => import("@/pages/AssetDetailPage.vue"),
    meta: { requiresAuth: true, title: "Equipment", parent: "/shop/assets" },
  },
  /**
   * Units (I9). Two path params rather than one, because a truck and a trailer share neither a table
   * nor a number space: the URL carries which of the two the id belongs to, so no screen has to
   * guess. `kind` here is the ROSTER's word — a reefer is a `trailer` — and `unitKindOf` draws the
   * kit distinction from `is_reefer`.
   */
  {
    path: "/shop/units",
    name: "units",
    component: () => import("@/pages/UnitsPage.vue"),
    meta: { requiresAuth: true, title: "Trucks & trailers", parent: "/shop" },
  },
  {
    path: "/shop/units/:kind/:id",
    name: "unit",
    component: () => import("@/pages/UnitDetailPage.vue"),
    meta: { requiresAuth: true, title: "Truck or trailer", parent: "/shop/units" },
  },
  {
    path: "/shop/inventory/:id",
    name: "part",
    component: () => import("@/pages/PartDetailPage.vue"),
    meta: { requiresAuth: true, title: "Part", parent: "/shop/inventory" },
  },
  /**
   * The count screen (I5 PR 2b). It shipped under `layout: "shop"` (D-INV17: no sidebar, a sticky
   * bottom bar) and renders in `AppShell` since 2026-09-10, when the owner opened a unit check from
   * the Units list and found a screen that shared nothing with the page it came from. The phone's
   * bottom bar survives inside the page (`WalkActions.vue`); the shell does not.
   *
   * ⚠ The route does NOT change while a count is open. Everything a walk does — type, confirm,
   * record, review, close — happens here, because a route change on a screen holding a wake lock
   * and an unsent queue is a screen that loses both.
   */
  {
    path: "/shop/count/:sessionId",
    name: "count-session",
    component: () => import("@/pages/CountSessionPage.vue"),
    meta: { requiresAuth: true, title: "Count", parent: "/shop" },
  },
  /**
   * The scan surface (I6). `layout: "shop"` — the last route carrying it since the count left the
   * shell on 2026-09-10 — because this is a phone held standing up, next to a shelf, with a scanner
   * in the other hand: a posture, not a page, and the shell's bottom bar is where the thumb is.
   *
   * ⚠ Like the count, the route does NOT change while the technician is scanning (D-INV17). Every
   * verb opens as an overlay on this page rather than navigating, so a rhythm of scan → issue →
   * scan is not four page loads. The rule was written for the camera, whose permission an installed
   * web app is documented to re-ask for on navigation, and it survives its original reason.
   */
  {
    path: "/shop/scan",
    name: "scan",
    component: () => import("@/pages/ScanPage.vue"),
    meta: { requiresAuth: true, title: "Scan", parent: "/shop", layout: "shop" },
  },
  /**
   * The label screen (I10). A DESK screen and not `layout: "shop"` — the scan and the count are a
   * phone held standing up in a bay; this is somebody at a computer next to a printer with a sheet
   * of blank stock in their hand.
   */
  {
    path: "/shop/labels",
    name: "labels",
    component: () => import("@/pages/LabelsPage.vue"),
    meta: { requiresAuth: true, title: "Labels", parent: "/shop" },
  },
  {
    path: "/shop/inspections",
    name: "annual-inspections",
    component: () => import("@/pages/AnnualInspectionsPage.vue"),
    meta: { requiresAuth: true, title: "Annual inspections", parent: "/shop" },
  },
  /**
   * Where FleetPal's annual and our record disagree (DISPATCH-BOARD-V2-PLAN Q-DBV2) — the list behind
   * the Shop card's "Annual dates to check". Not under `/shop/inspections/`, which `:id` owns.
   */
  {
    path: "/shop/annual-dates",
    name: "annual-dates",
    component: () => import("@/pages/AnnualDatesPage.vue"),
    meta: { requiresAuth: true, title: "Dates FleetPal disagrees on", parent: "/shop/inspections" },
  },
  /**
   * The inspector register lives under Settings since 2026-10-27 (D-MX1, owner: "Inspectors can
   * move to settings pages"). Declared here and not in `routes/settings.ts` because the screen is
   * maintenance's — the file a URL is declared in names the module that owns it. The old address
   * redirects: the annual-inspection form's "add an inspector first" link and any bookmark keep working.
   */
  {
    path: "/settings/inspectors",
    name: "inspector-register",
    component: () => import("@/pages/InspectorRegisterPage.vue"),
    meta: { requiresAuth: true, title: "Who can inspect", parent: "/settings" },
  },
  {
    path: "/settings/devices",
    name: "devices",
    component: () => import("@/pages/DevicesSettingsPage.vue"),
    meta: { requiresAuth: true, title: "Printers & scanners", parent: "/settings" },
  },
  {
    path: "/shop/inspectors",
    name: "inspector-register-legacy",
    redirect: { name: "inspector-register" },
  },
  {
    path: "/shop/inspections/:id",
    name: "annual-inspection",
    component: () => import("@/pages/AnnualInspectionFormPage.vue"),
    meta: { requiresAuth: true, title: "Annual inspection", parent: "/shop/inspections" },
  },
];
