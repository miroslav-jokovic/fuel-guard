import type { RouteRecordRaw } from "vue-router";

/** Trucks, trailers and the equipment-integrity surfaces that hang off them. */
export const fleetRoutes: RouteRecordRaw[] = [
  {
    path: "/vehicles",
    name: "vehicles",
    component: () => import("@/pages/VehiclesPage.vue"),
    meta: { requiresAuth: true, title: "Vehicles" },
  },
  {
    path: "/vehicles/:id",
    name: "vehicle-detail",
    component: () => import("@/pages/VehicleDetailPage.vue"),
    meta: { requiresAuth: true, title: "Vehicle" },
  },
  {
    path: "/odometer",
    name: "odometer",
    component: () => import("@/pages/OdometerPage.vue"),
    meta: { requiresAuth: true, title: "Odometer Mismatches" },
  },
  {
    path: "/coverage",
    name: "coverage",
    component: () => import("@/pages/CoveragePage.vue"),
    meta: { requiresAuth: true, title: "Detection Coverage", parent: "/settings" },
  },
  {
    path: "/recall-audit",
    name: "recall-audit",
    component: () => import("@/pages/RecallAuditPage.vue"),
    meta: { requiresAuth: true, title: "Recall Audit", parent: "/settings" },
  },
  {
    path: "/trailers",
    name: "trailers",
    component: () => import("@/pages/TrailersPage.vue"),
    meta: { requiresAuth: true, title: "Trailers" },
  },
  {
    path: "/reefer-coverage",
    name: "reefer-coverage",
    component: () => import("@/pages/ReeferCoveragePage.vue"),
    meta: { requiresAuth: true, title: "Reefer Coverage", parent: "/settings" },
  },
  {
    path: "/idling",
    name: "idling",
    component: () => import("@/pages/IdlingPage.vue"),
    meta: { requiresAuth: true, title: "Idling" },
  },
  {
    // Safety › Drug & Alcohol (MEDSTOP-PLAN §6). Gated by its surface entry, `section("safety")`.
    path: "/drug-alcohol",
    name: "drug-alcohol",
    component: () => import("@/pages/DrugAlcoholPage.vue"),
    meta: { requiresAuth: true, title: "Drug & Alcohol" },
  },
  {
    // Safety › Roadside inspections (INSPECTION-CHALLENGE-PLAN §6, Q-FM7 (a)). Gated by its surface
    // entry, `section("safety")`.
    path: "/roadside-inspections",
    name: "roadside-inspections",
    component: () => import("@/pages/RoadsideInspectionsPage.vue"),
    meta: { requiresAuth: true, title: "Roadside inspections" },
  },
  {
    // A real page, not a drawer over the list, so a report can be linked and Back returns to the
    // list's filters (contract §5.7 "Route", the Loads arrangement).
    path: "/roadside-inspections/:id",
    name: "roadside-inspection",
    component: () => import("@/pages/RoadsideInspectionPage.vue"),
    meta: { requiresAuth: true, title: "Roadside inspection", parent: "/roadside-inspections" },
  },
];
