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
 * for both — see the reasoning in `packages/shared/src/surfaces.ts`, which is a permission argument
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
    meta: { requiresAuth: true, title: "Repair spend", parent: "/shop" },
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
    meta: { requiresAuth: true, title: "Assets", parent: "/shop" },
  },
  {
    path: "/shop/assets/:id",
    name: "asset",
    component: () => import("@/pages/AssetDetailPage.vue"),
    meta: { requiresAuth: true, title: "Asset", parent: "/shop/assets" },
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
    meta: { requiresAuth: true, title: "Units", parent: "/shop" },
  },
  {
    path: "/shop/units/:kind/:id",
    name: "unit",
    component: () => import("@/pages/UnitDetailPage.vue"),
    meta: { requiresAuth: true, title: "Unit", parent: "/shop/units" },
  },
  {
    path: "/shop/inventory/:id",
    name: "part",
    component: () => import("@/pages/PartDetailPage.vue"),
    meta: { requiresAuth: true, title: "Part", parent: "/shop/inventory" },
  },
  /**
   * The count screen (I5 PR 2b). `layout: "shop"` is D-INV17: no sidebar, full-height viewport, a
   * sticky bottom action bar inside the safe area — a phone held in a bay, not a desk screen.
   *
   * ⚠ The route does NOT change while a count is open. Everything a walk does — type, confirm,
   * record, review, close — happens here, because a route change on a screen holding a wake lock
   * and an unsent queue is a screen that loses both.
   */
  {
    path: "/shop/count/:sessionId",
    name: "count-session",
    component: () => import("@/pages/CountSessionPage.vue"),
    meta: { requiresAuth: true, title: "Count", parent: "/shop", layout: "shop" },
  },
  /**
   * The scan surface (I6). `layout: "shop"` for the same reason the count screen has it — a phone
   * held standing up, next to a shelf, with a scanner in the other hand.
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
  {
    path: "/shop/inspections",
    name: "annual-inspections",
    component: () => import("@/pages/AnnualInspectionsPage.vue"),
    meta: { requiresAuth: true, title: "Annual inspections", parent: "/shop" },
  },
  {
    path: "/shop/inspectors",
    name: "inspector-register",
    component: () => import("@/pages/InspectorRegisterPage.vue"),
    meta: { requiresAuth: true, title: "Inspectors", parent: "/shop" },
  },
  {
    path: "/shop/inspections/:id",
    name: "annual-inspection",
    component: () => import("@/pages/AnnualInspectionFormPage.vue"),
    meta: { requiresAuth: true, title: "Annual inspection", parent: "/shop/inspections" },
  },
];
