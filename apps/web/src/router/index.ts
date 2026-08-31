import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import type { AppSection } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";

/**
 * Route meta, TYPED — added with R0 (D-ROS7).
 *
 * `requiresManage` used to be a bare `true` resolved against one global boolean, and `meta` was
 * untyped, so neither the value nor its absence could be checked. It now names the SECTION the route
 * requires, and typing it on `AppSection` means a misspelled or retired section name is a compile
 * error rather than a route that silently admits everybody — which is the failure mode a permission
 * check must never have.
 */
declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiresAdmin?: boolean;
    /** The section whose `manage` access this route needs. */
    requiresManage?: AppSection;
    requiresAuditAccess?: boolean;
    title?: string;
    parent?: string;
  }
}
import { authRoutes } from "./routes/auth";
import { coreRoutes } from "./routes/core";
import { dispatchRoutes } from "./routes/dispatch";
import { hazmatRoutes } from "./routes/hazmat";
import { fleetRoutes } from "./routes/fleet";
import { driverRoutes } from "./routes/drivers";
import { recruitmentRoutes } from "./routes/recruitment";
import { fuelRoutes } from "./routes/fuel";
import { financeRoutes } from "./routes/finance";
import { settingsRoutes } from "./routes/settings";
import { systemRoutes, notFoundRoute } from "./routes/system";

/**
 * The route table, composed from one module per product area.
 *
 * It was a single 437-line array until 2026-08-25, which put this file at 480 of the 500-line
 * budget — close enough that the next feature to add a route broke the build, and one did. Splitting
 * it by area is mechanical, but the file decides where every URL in the product lands, so the split
 * shipped with `routeTable.test.ts`: two snapshots captured against the unsplit table, one blind to
 * declaration order and one deliberately sensitive to it. They are the evidence that this
 * rearrangement changed nothing.
 *
 * ⚠ Order between the areas below is not load-bearing — vue-router v4 ranks matches by specificity,
 * so a static segment beats a param wherever it is declared, and the `resolution` snapshot pins
 * that. Order WITHIN an area file is likewise free. What is not free is a catch-all: `path:
 * "/:pathMatch(.*)*"` matches everything, so it must be appended after every real route, and this
 * is the only place that can guarantee it.
 */
const routes: RouteRecordRaw[] = [
  ...authRoutes,
  ...coreRoutes,
  ...dispatchRoutes,
  ...hazmatRoutes,
  ...fleetRoutes,
  ...driverRoutes,
  ...recruitmentRoutes,
  ...fuelRoutes,
  ...financeRoutes,
  ...settingsRoutes,
  ...systemRoutes,
  // Must stay last: it matches everything. See `routes/system.ts`.
  notFoundRoute,
];

const designSystemLabEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESIGN_SYSTEM_LAB === "true";

if (designSystemLabEnabled) {
  routes.unshift({
    path: "/__design-system",
    name: "design-system-lab",
    component: () => import("@/dev/DesignSystemLabPage.vue"),
    meta: { public: true, layout: "lab", title: "Design system lab" },
  });
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (designSystemLabEnabled && to.meta.layout === "lab") return true;
  const session = useSessionStore();
  if (!session.initialized) await session.init();

  if (!session.isAuthenticated) {
    return to.meta.public ? true : { name: "login" };
  }
  // Authenticated but no membership yet (audit B3) → only no-org auth pages allowed.
  if (!session.hasOrg) {
    return to.meta.allowNoOrg ? true : { name: "pending" };
  }
  // Drivers use the Driver app; they may not use the web dashboard (Driver App, Phase 1).
  if (session.role === "driver") {
    return to.name === "driver-app" ? true : { name: "driver-app" };
  }
  // Authenticated with an org.
  if (to.name === "login" || to.name === "pending" || to.name === "driver-app")
    return { name: "dashboard" };
  if (to.meta.requiresAdmin && !session.admin) return { name: "dashboard" };
  // `requiresManage` NAMES a section since R0 — it used to be a bare `true` resolved against one
  // global boolean, which is why /recruitment could never use it without bouncing the recruiter
  // the section exists for.
  if (to.meta.requiresManage && !session.can(to.meta.requiresManage)) return { name: "dashboard" };
  if (to.meta.requiresAuditAccess && !(session.admin || session.readOnly))
    return { name: "dashboard" };
  return true;
});
