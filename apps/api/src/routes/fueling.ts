import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { registerPlanRoutes } from "./fueling/plans.js";
import { registerMapRoutes } from "./fueling/mapProxies.js";
import { registerNetworkRoutes } from "./fueling/networks.js";
import { registerStationRoutes } from "./fueling/stations.js";
import { registerSpendRoutes } from "../modules/fuel-spend/index.js";
import { registerExceptionRoutes } from "../modules/fuel-spend/index.js";

/**
 * Fueling / route-planning routes, assembled from cohesive modules (P2 split — was one 546-line file):
 *  - `fueling/plans`     — smart-fuel plan generation + saved-plan history
 *  - `fueling/mapProxies`— HERE map-config/tiles, geocode-suggest, vehicle-location (keys stay server-side)
 *  - `fueling/networks`  — price-report + truck-stop network ingestion (Pilot family, posted, Kwik Trip, …)
 *  - `fueling/stations`  — the Truck Stops listing with each station's effective planning price
 *  - `fueling/spend`     — rebuild of the daily fuel-spend rollup (reads go direct to PostgREST)
 * All share ONE router + the `requireAuth` gate, so mounting (`/api/fueling`) and behavior are unchanged.
 */
export function fuelingRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  registerPlanRoutes(router);
  registerMapRoutes(router);
  registerNetworkRoutes(router);
  registerStationRoutes(router);
  registerSpendRoutes(router);
  registerExceptionRoutes(router);
  return router;
}
