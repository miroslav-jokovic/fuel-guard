import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { registerPlanRoutes, registerMapRoutes, registerStationRoutes } from "../modules/routing/index.js";
import { registerNetworkRoutes } from "../modules/posted-prices/index.js";
import { registerStatementRoutes } from "../modules/fuel-spend/index.js";
import { registerSpendRoutes } from "../modules/fuel-spend/index.js";
import { registerExceptionRoutes } from "../modules/fuel-spend/index.js";

/**
 * Fueling / route-planning routes, assembled from cohesive modules (P2 split — was one 546-line file):
 *  - `fueling/plans`     — smart-fuel plan generation + saved-plan history
 *  - `fueling/mapProxies`— HERE map-config/tiles, geocode-suggest, vehicle-location (keys stay server-side)
 *  - posted-prices routes — price-report + network ingestion (moved to the collector at P1.6)
 *  - fuel-spend statements — statement/recon routes (moved to their owner at P1.6)
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
  registerStatementRoutes(router);
  registerStationRoutes(router);
  registerSpendRoutes(router);
  registerExceptionRoutes(router);
  return router;
}
