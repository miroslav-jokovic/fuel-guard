/**
 * routing — the route-planning support module, carved 2026-08-27 (program step P1.7,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md). Owns `geocode_cache`,
 * `route_geometries`, `route_fuel_settings`, `fuel_plans` (1 production row measured at the
 * carve-out — the drop decision is the owner's, recorded in the program plan §6).
 *
 * Named debts, inherited knowingly:
 *  - fuelPlanning calls Samsara live (fuel level + HOS) and HERE inline with the stop-selection
 *    math — the vendor/math split is future work; the imports ride the routing -> samsara pair.
 *  - the stations listing and the planner assemble effective-price inputs separately (both
 *    resolve through shared's resolveEffectivePrice); collapsing the assembly waits until the
 *    planning path has tests. Since 2026-10-09 it has ONE: a characterisation of the whole answer
 *    ("plans fuel stops on a fixed line from a manual fuel level, every read scoped to the org",
 *    fuelPlanning.test.ts), written before TC3 split the planner. It pins the manual-fuel path only;
 *    the live-Samsara path and the price assembly are still untested, so this debt stands.
 */
export { geocodeStation, geocodeSuggest, geocodeAddress, type Coords, type GeoPrecision } from "./geocode.js";
export { getOrComputeRoute, type RouteGeometry } from "./routeGeometry.js";
export { planFuelRoute, loadPlanningTruck, solveOnRoute, type PlanRequest, type PlanResult, type PlanStopView } from "./fuelPlanning.js";
export { saveFuelPlanHistory } from "./fuelPlanHistory.js";
export { registerPlanRoutes } from "./routes/plans.js";
export { registerStationRoutes } from "./routes/stations.js";
export { registerMapRoutes } from "./routes/mapProxies.js";
export { registerFuelSettingsRoutes } from "./routes/fuelSettings.js";
export { readStationAddresses, type StationAddress } from "./planStopView.js";
