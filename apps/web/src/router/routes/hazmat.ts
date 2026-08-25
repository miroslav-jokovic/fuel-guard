import type { RouteRecordRaw } from "vue-router";

/** HazmatGuard. Gated on the `hazmatguard` module as well as the role (see `lib/nav.ts`). */
export const hazmatRoutes: RouteRecordRaw[] = [
  {
    path: "/hazmat",
    name: "hazmat",
    component: () => import("@/pages/HazmatPage.vue"),
    meta: { requiresAuth: true, title: "HazmatGuard" },
  },
  {
    path: "/hazmat/calculator",
    name: "hazmat-calculator",
    component: () => import("@/pages/HazmatCalculatorPage.vue"),
    meta: { requiresAuth: true, title: "Placard Calculator", parent: "/hazmat" },
  },
  {
    path: "/hazmat/loads",
    name: "hazmat-loads",
    component: () => import("@/pages/HazmatLoadsPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Loads", parent: "/hazmat" },
  },
  {
    path: "/hazmat/loads/new",
    name: "hazmat-load-new",
    component: () => import("@/pages/HazmatLoadFormPage.vue"),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      title: "New Hazmat Load",
      parent: "/hazmat/loads",
    },
  },
  {
    path: "/hazmat/loads/:id",
    name: "hazmat-load-detail",
    component: () => import("@/pages/HazmatLoadDetailPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Load", parent: "/hazmat/loads" },
  },
  {
    path: "/hazmat/review",
    name: "hazmat-review",
    component: () => import("@/pages/HazmatReviewPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Review", parent: "/hazmat" },
  },
  {
    // H-C2: Cargo-Tank Profiles page removed — tank capacity lives on the trailer (Fleet → Trailers).
    path: "/hazmat/settings/equipment",
    redirect: "/trailers",
  },
];
