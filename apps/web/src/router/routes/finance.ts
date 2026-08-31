import type { RouteRecordRaw } from "vue-router";

/**
 * The finance sections (P5, D-SEP7/8): accounting, billing, and the maintenance section that is
 * NOT the /maintenance downtime page — that URL and route name were taken by system.ts long
 * before this section existed, so the shop lives at /shop (the program plan's §6 Q7 fallback).
 * Routes carry requiresAuth only, per the house rule — the pages self-gate via the section
 * matrix, and the API refuses the wrong role regardless.
 */
export const financeRoutes: RouteRecordRaw[] = [
  {
    path: "/accounting",
    name: "accounting",
    component: () => import("@/pages/AccountingLedgerPage.vue"),
    meta: { requiresAuth: true, title: "Money in & out" },
  },
  {
    path: "/cpm",
    name: "cpm",
    component: () => import("@/pages/CpmReportPage.vue"),
    meta: { requiresAuth: true, title: "Cost per mile" },
  },
  {
    path: "/cost-schedule",
    name: "cost-schedule",
    component: () => import("@/pages/CostSchedulePage.vue"),
    meta: { requiresAuth: true, title: "Truck fixed costs" },
  },
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
    meta: { requiresAuth: true, title: "Annual inspections", parent: "shop" },
  },
  {
    path: "/shop/inspections/:id",
    name: "annual-inspection",
    component: () => import("@/pages/AnnualInspectionFormPage.vue"),
    meta: { requiresAuth: true, title: "Annual inspection", parent: "annual-inspections" },
  },
];
