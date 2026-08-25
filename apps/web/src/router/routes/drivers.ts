import type { RouteRecordRaw } from "vue-router";

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
    meta: { requiresAuth: true, title: "Driver" },
  },
  {
    path: "/compliance",
    name: "compliance",
    component: () => import("@/pages/CompliancePage.vue"),
    meta: { requiresAuth: true, title: "Driver Qualification" },
  },
  {
    // D1/D2: the qualification file became a SECTION of the driver detail page — one driver, one
    // page. This redirect is load-bearing: bookmarks, the fleet table's links, notification deep
    // links and the binder's references all say /compliance/:id, and they all keep working.
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
    meta: { requiresAuth: true, title: "Driver Performance" },
  },
];
