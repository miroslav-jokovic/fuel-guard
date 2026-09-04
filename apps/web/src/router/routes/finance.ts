import type { RouteRecordRaw } from "vue-router";

/**
 * The finance sections (P5, D-SEP7/8): the fleet report, billing, and the maintenance section that is
 * NOT the /maintenance downtime page — that URL and route name were taken by system.ts long
 * before this section existed, so the shop lives at /shop (the program plan's §6 Q7 fallback).
 * Routes carry requiresAuth only, per the house rule — the pages self-gate via the section
 * matrix, and the API refuses the wrong role regardless.
 */
export const financeRoutes: RouteRecordRaw[] = [
  {
    // Renamed from /cpm at G7. The page opened on a per-truck cost table when it was called "Cost
    // per mile"; it now opens on what the fleet earned, spent and kept, carries the income
    // statement and its ten families, and reports per-truck REVENUE only — no per-truck cost
    // figure is precise (D-FLEET1). A name is a promise about what a page answers, and that one
    // had stopped being true.
    path: "/fleet-report",
    name: "fleet-report",
    component: () => import("@/pages/CpmReportPage.vue"),
    meta: { requiresAuth: true, title: "Fleet report" },
  },
  // The old address, kept working. An accountant with /cpm bookmarked should land on the page, not
  // on a 404 — and the redirect costs one record.
  { path: "/cpm", redirect: { name: "fleet-report" } },
  {
    path: "/billing",
    name: "billing",
    component: () => import("@/pages/BillingPage.vue"),
    meta: { requiresAuth: true, title: "Revenue & margin" },
  },
  {
    path: "/shop",
    name: "shop",
    component: () => import("@/pages/MaintenanceSpendPage.vue"),
    meta: { requiresAuth: true, title: "Maintenance" },
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
