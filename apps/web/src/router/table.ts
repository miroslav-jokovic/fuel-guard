import type { RouteRecordRaw } from "vue-router";
import { authRoutes } from "./routes/auth";
import { coreRoutes } from "./routes/core";
import { dispatchRoutes } from "./routes/dispatch";
import { hazmatRoutes } from "./routes/hazmat";
import { fleetRoutes } from "./routes/fleet";
import { driverRoutes } from "./routes/drivers";
import { recruitmentRoutes } from "./routes/recruitment";
import { fuelRoutes } from "./routes/fuel";
import { financeRoutes } from "./routes/finance";
import { maintenanceRoutes } from "./routes/maintenance";
import { settingsRoutes } from "./routes/settings";
import { legalRoutes } from "./routes/legal";
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
 *
 * ⚠ It lives in its own file, apart from `createRouter` in `./index.ts`, since SP5 (plan §4b, owner
 * ruling 2026-09-30). `useOpens()` answers "does this link open for me" by resolving against the
 * app's router, and a component mounted without one (every component test in this app stubs
 * `RouterLink` and installs none) resolves against THIS table instead. Importing `./index` for that
 * would drag in the guard and the session store it reads, which is the router ↔ store circle. The
 * table has neither: the route modules name their pages through lazy `import()`, so nothing here
 * evaluates a component.
 */
export const ROUTE_TABLE: readonly RouteRecordRaw[] = [
  ...authRoutes,
  ...coreRoutes,
  ...dispatchRoutes,
  ...hazmatRoutes,
  ...fleetRoutes,
  ...driverRoutes,
  ...recruitmentRoutes,
  ...fuelRoutes,
  ...financeRoutes,
  ...maintenanceRoutes,
  ...settingsRoutes,
  ...legalRoutes,
  ...systemRoutes,
  // Must stay last: it matches everything. See `routes/system.ts`.
  notFoundRoute,
];