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
 *    planning path has tests — it has NONE today, and an untested change to the money path is
 *    how regressions ship.
 */
export { geocodeStation, geocodeSuggest, geocodeAddress, type Coords, type GeoPrecision } from "./geocode.js";
export { getOrComputeRoute, type RouteGeometry } from "./routeGeometry.js";
export { planFuelRoute, type PlanRequest } from "./fuelPlanning.js";
export { saveFuelPlanHistory } from "./fuelPlanHistory.js";
export { registerPlanRoutes } from "./routes/plans.js";
export { registerStationRoutes } from "./routes/stations.js";
export { registerMapRoutes } from "./routes/mapProxies.js";
