import type { RouteRecordRaw } from "vue-router";
import { QUALIFICATION_ATTENTION_VIEW } from "@silvicom/shared";

/** Drivers, their qualification files and their performance. */
export const driverRoutes: RouteRecordRaw[] = [
  {
    path: "/drivers",
    name: "drivers",
    component: () => import("@/pages/DriversPage.vue"),
    meta: { requiresAuth: true, title: "Drivers" },
  },
  {
    path: "/drivers/:id",
    name: "driver-detail",
    component: () => import("@/pages/DriverDetailPage.vue"),
    // `parent` gives the page its breadcrumb, the shell's Back, and the not-found answer's way back
    // to the list (F21) — the three are one walk over this key.
    meta: { requiresAuth: true, title: "Driver", parent: "/drivers" },
  },
  {
    // DQ-INTO-DRIVERS-PLAN D-DQ16 (DD4, 2026-11-06): the Driver Qualification list folded into Drivers.
    // A redirect, not a 404, because the path is in bookmarks, saved links and older notifications. It
    // lands on DD1's built-in view, read from that view so the two cannot drift: every driver whose
    // file needs attention, worst first.
    path: "/compliance",
    name: "compliance",
    redirect: { name: "drivers", query: Object.fromEntries(new URLSearchParams(QUALIFICATION_ATTENTION_VIEW.query)) },
  },
  {
    // D1/D2: the qualification file became a SECTION of the driver detail page — one driver, one
    // page. This redirect is load-bearing: bookmarks, notifications already sent and the PDFs of
    // binders already built all say /compliance/:id, and they all keep working (D-DQ16).
    path: "/compliance/:id",
    name: "driver-qualification",
    redirect: (to) => ({
      name: "driver-detail",
      params: { id: to.params.id },
      query: { section: "qualification" },
    }),
  },
  {
    path: "/driver-performance",
    name: "driver-performance",
    component: () => import("@/pages/DriverPerformancePage.vue"),
    meta: { requiresAuth: true, title: "Driver performance" },
  },
];
