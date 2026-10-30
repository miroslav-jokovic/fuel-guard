import type { RouteRecordRaw } from "vue-router";
import { KIT_RULES_SHOWN } from "@silvicom/shared";

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
  /**
   * The Shop page's tabs (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.3, M6). These four were pages of their
   * own until M6 folded them into `/shop` as tabs; their addresses stay as redirects so an alert
   * (`notificationRoute.ts`'s roadside link), a bookmark or another page's link lands on the same list,
   * with every query it carried. They stay in the surface catalogue under the same keys (D-MX6): the
   * Shop page asks each one's grant through `useOpens` before it draws that tab, so a per-person denial
   * still closes exactly the list it closed. Roadside's own Open/Recorded was `tab=` and is `show=` now.
   */
  { path: "/shop/repair-spend", name: "repair-spend", redirect: (to) => ({ path: "/shop", query: { ...to.query, tab: "bills" } }) },
  { path: "/shop/work-orders", name: "work-orders", redirect: (to) => ({ path: "/shop", query: { ...to.query, tab: "work-orders" } }) },
  {
    path: "/shop/roadside-repairs",
    name: "roadside-repairs",
    redirect: (to) => {
      const { tab: old, ...rest } = to.query;
      return { path: "/shop", query: { ...rest, ...(old === "recorded" ? { show: "recorded" } : {}), tab: "roadside" } };
    },
  },
  { path: "/shop/defects", name: "defects", redirect: (to) => ({ path: "/shop", query: { ...to.query, tab: "defects" } }) },
  {
    path: "/shop/inventory",
    name: "parts",
    component: () => import("@/pages/PartsPage.vue"),
    meta: { requiresAuth: true, title: "Shop parts", parent: "/shop" },
  },
  /**
   * The assets (I8). A separate address from `/shop/inventory` rather than a tab on it: §2.1's seam
   * is two different questions about two different kinds of row, and one screen with a toggle is how
   * the driver page grew six tabs. Its own sidebar row again since M7 (Q-MX7), so its Back is Shop's.
   */
  /**
   * EA2 renamed the tabs to who holds the thing (EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL §3.4): M7's
   * `on-trucks` is `trucks`, its `inventory` is `shop`. A bookmark or an alert link keeps landing on the
   * list it meant; anything else in its query is carried.
   */
  {
    path: "/shop/assets",
    name: "assets",
    component: () => import("@/pages/AssetsPage.vue"),
    meta: { requiresAuth: true, title: "Equipment", parent: "/shop" },
    beforeEnter: (to) => {
      const renamed = { "on-trucks": "trucks", inventory: "shop" }[String(to.query.tab ?? "")];
      return renamed ? { path: to.path, query: { ...to.query, tab: renamed } } : true;
    },
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
  /**
   * "Missing equipment" was Trucks & trailers' `?show=short` until M7 moved it to Equipment's On trucks
   * tab (§7a.4). A bookmark keeps landing on the same list, its kind and search carried — and since
   * EA2 hid Should carry (`KIT_RULES_SHOWN`), on Equipment's Trucks & trailers tab without the
   * "missing" filter, which there is no longer.
   */
  {
    path: "/shop/units",
    name: "units",
    component: () => import("@/pages/UnitsPage.vue"),
    meta: { requiresAuth: true, title: "Trucks & trailers", parent: "/shop" },
    beforeEnter: (to) => {
      if (to.query.show !== "short") return true;
      const { show: _short, ...rest } = to.query;
      return { path: "/shop/assets", query: { ...rest, tab: "trucks", ...(KIT_RULES_SHOWN ? { show: "missing" } : {}) } };
    },
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
