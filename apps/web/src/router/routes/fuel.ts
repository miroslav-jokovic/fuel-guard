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
  {
    path: "/fuel-reconciliation",
    name: "fuel-reconciliation",
    component: () => import("@/pages/FuelReconciliationPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Fuel Reconciliation" },
  },  {
    path: "/fuel-exceptions",
    name: "fuel-exceptions",
    component: () => import("@/pages/FuelExceptionsPage.vue"),
    // `requiresAuth` only, deliberately NOT `requiresManage`: the ledger is a read surface, and a
    // controller checking what was recovered should not need permission to upload a statement. Moving
    // a finding is gated on the API route, which is where the decision actually happens.
    meta: { requiresAuth: true, title: "Fuel Exceptions" },
  },

  {
    path: "/import",
    name: "import",
    component: () => import("@/pages/ImportPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Import EFS Report" },
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
