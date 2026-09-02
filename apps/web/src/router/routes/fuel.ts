import type { RouteRecordRaw } from "vue-router";

/** Fuel: planning, the log, the money, the cards and the exceptions raised against them. */
export const fuelRoutes: RouteRecordRaw[] = [
  {
    path: "/fuel-planning",
    name: "fuel-planning",
    component: () => import("@/pages/FuelPlanningPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Planning" },
  },
  {
    path: "/truck-stops",
    name: "truck-stops",
    component: () => import("@/pages/FuelStationsPage.vue"),
    meta: { requiresAuth: true, title: "Truck Stops" },
  },
  {
    path: "/fuel-log",
    name: "fuel-log",
    component: () => import("@/pages/FuelLogPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Log" },
  },
  /**
   * D-FX8 — the page is Fuel Spend, and reconciliation is one tab of it.
   *
   * It was called Reconciliation because that is what it used to be. Five of its seven tabs are spend
   * analytics and its own source comments call it "fuel spend" throughout, so a fleet manager asking
   * "why is fuel up" had no reason to click a nav item called Reconciliation, and a controller wanting
   * to audit an invoice arrived at a trend chart.
   */
  {
    path: "/fuel-spend",
    name: "fuel-spend",
    component: () => import("@/pages/FuelReconciliationPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Spend" },
  },
  {
    path: "/fuel-spend/exceptions",
    name: "fuel-exceptions",
    component: () => import("@/pages/FuelExceptionsPage.vue"),
    // `requiresAuth` only, deliberately NOT `requiresManage`: the ledger is a read surface, and a
    // controller checking what was recovered should not need permission to upload a statement. Moving
    // a finding is gated on the API route, which is where the decision actually happens.
    meta: { requiresAuth: true, title: "Fuel Exceptions", parent: "/fuel-spend" },
  },
  {
    path: "/ifta",
    name: "ifta",
    component: () => import("@/pages/IftaLedgerPage.vue"),
    // `requiresAuth` only, like the exception ledger: this is a read surface for a controller, who
    // should not need permission to upload a statement in order to see what the fleet owes Texas.
    meta: { requiresAuth: true, title: "IFTA" },
  },
  // The old paths are kept forever, not for a deprecation window. This page exists to be sent to
  // somebody: links to it are in emails, in tickets, and in the `?tab=&from=&to=` form the filters
  // produce. `redirect` preserves the query string, so a link sent in June still opens on what its
  // sender was looking at.
  { path: "/fuel-reconciliation", redirect: "/fuel-spend" },
  { path: "/fuel-exceptions", redirect: "/fuel-spend/exceptions" },

  {
    path: "/import",
    name: "import",
    component: () => import("@/pages/ImportPage.vue"),
    meta: { requiresAuth: true, title: "Import EFS Report" },
  },
  {
    path: "/transactions",
    name: "transactions",
    component: () => import("@/pages/TransactionsPage.vue"),
    meta: { requiresAuth: true, title: "Transactions" },
  },
  {
    path: "/rejections",
    name: "rejections",
    component: () => import("@/pages/RejectionsPage.vue"),
    meta: { requiresAuth: true, title: "Rejections" },
  },
  {
    // Read is open to every fuel-viewing role; the write actions gate themselves from the
    // server-computed `capabilities`, which the browser cannot work out on its own.
    path: "/fuel-cards",
    name: "fuel-cards",
    component: () => import("@/pages/FuelCardsPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Cards" },
  },
  {
    path: "/fuel-cards/:id",
    name: "fuel-card-detail",
    component: () => import("@/pages/FuelCardDetailPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Card", parent: "/fuel-cards" },
  },
  {
    path: "/anomalies",
    name: "anomalies",
    component: () => import("@/pages/AnomaliesPage.vue"),
    meta: { requiresAuth: true, title: "Alerts" },
  },
  {
    // Merged into Fuel Log (same underlying fuel_transactions data) — redirect old links.
    path: "/fuel-events",
    redirect: "/fuel-log",
  },
];
