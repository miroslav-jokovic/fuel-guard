import type { RouteRecordRaw } from "vue-router";

/**
 * The finance sections (P5, D-SEP7/8): the fleet report and billing.
 *
 * ⚠ The four `/shop` routes were declared here until I4 (INVENTORY-PLAN.md) and now live in
 * `maintenance.ts`. They were here because maintenance arrived as a ledger FAMILY — a filtered view
 * of what finance had already booked — and that stopped being true when the module gained tables of
 * its own at I2. Routes carry requiresAuth only, per the house rule: the section question is
 * answered once in `SURFACES` and read by the guard (D-SURF3), and the API refuses the wrong role
 * regardless.
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
    component: () => import("@/pages/FleetReportPage.vue"),
    meta: { requiresAuth: true, title: "Fleet report" },
  },
  // The old address, kept working. An accountant with /cpm bookmarked should land on the page, not
  // on a 404 — and the redirect costs one record.
  { path: "/cpm", redirect: { name: "fleet-report" } },
  {
    path: "/billing",
    name: "billing",
    component: () => import("@/pages/BillingPage.vue"),
    meta: { requiresAuth: true, title: "Invoices" },
  },
];
