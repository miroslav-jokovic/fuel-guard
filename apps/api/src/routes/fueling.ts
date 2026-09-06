import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { registerPlanRoutes, registerMapRoutes, registerStationRoutes } from "../modules/routing/index.js";
import { registerNetworkRoutes } from "../modules/posted-prices/index.js";
import { registerStatementRoutes } from "../modules/fuel-spend/index.js";
import { registerDiscountRuleRoutes, registerFuelExportRoutes } from "../modules/fuel/index.js";
import { registerSpendRoutes } from "../modules/fuel-spend/index.js";
import { registerExceptionRoutes } from "../modules/fuel-spend/index.js";
import { registerFeedFreshnessRoutes, registerEfsExportRoutes } from "../modules/efs/index.js";

/**
 * Fueling / route-planning routes, assembled from cohesive modules (P2 split — was one 546-line file):
 *  - `fueling/plans`     — smart-fuel plan generation + saved-plan history
 *  - `fueling/mapProxies`— HERE map-config/tiles, geocode-suggest, vehicle-location (keys stay server-side)
 *  - posted-prices routes — price-report + network ingestion (moved to the collector at P1.6)
 *  - fuel-spend statements — statement/recon routes (moved to their owner at P1.6)
 *  - `fueling/stations`  — the Truck Stops listing with each station's effective planning price
 *  - `fueling/spend`     — rebuild of the daily fuel-spend rollup (reads go direct to PostgREST)
 *  - `fueling/exports`   — a scoped CSV per fuel list, from the module that owns each table (P2)
 * All share ONE router + the `requireAuth` gate, so mounting (`/api/fueling`) and behavior are unchanged.
 */
export function fuelingRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  registerPlanRoutes(router);
  registerMapRoutes(router);
  registerNetworkRoutes(router);
  registerStatementRoutes(router);
  registerDiscountRuleRoutes(router);
  registerStationRoutes(router);
  registerSpendRoutes(router);
  registerExceptionRoutes(router);
  // A7 / FUEL-T5 — when each EFS feed last delivered. Mounted here rather than on the admin-only
  // integration router because its readers are the ones looking at Transactions and Rejections.
  registerFeedFreshnessRoutes(router);
  // FUEL-P2 — a scoped CSV per fuel list. Two modules, because the tables have two owners (D-SEP1:
  // `efs_transactions` is the efs collector's), one URL prefix, because the reader is one person
  // looking at one page.
  registerFuelExportRoutes(router);
  registerEfsExportRoutes(router);
  return router;
}
