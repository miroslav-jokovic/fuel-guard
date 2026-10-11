import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { registerPlanRoutes, registerMapRoutes, registerStationRoutes, registerFuelSettingsRoutes } from "../modules/routing/index.js";
import { registerNetworkRoutes } from "../modules/posted-prices/index.js";
import { registerStatementRoutes } from "../modules/fuel-spend/index.js";
import { registerDiscountRuleRoutes, registerFuelExportRoutes } from "../modules/fuel/index.js";
import { registerSpendRoutes, registerReportRoutes } from "../modules/fuel-spend/index.js";
import { registerExceptionRoutes, registerOpportunityRoutes } from "../modules/fuel-spend/index.js";
import { registerFeedFreshnessRoutes, registerEfsExportRoutes } from "../modules/efs/index.js";

/**
 * Fueling / route-planning routes, assembled from cohesive modules (P2 split — was one 546-line file):
 *  - `fueling/plans`     — smart-fuel plan generation + saved-plan history
 *  - `fueling/mapProxies`— HERE map-config/tiles, geocode-suggest, vehicle-location (keys stay server-side)
 *  - posted-prices routes — price-report + network ingestion (moved to the collector at P1.6)
 *  - fuel-spend statements — statement/recon routes (moved to their owner at P1.6)
 *  - `fueling/stations`  — the Truck Stops listing with each station's effective planning price
 *  - `fueling/spend`     — rebuild of the daily fuel-spend rollup (reads go direct to PostgREST)
 *  - `fueling/report`    — the Fuel Costs report's days, by network, for a range and the one before it
 *  - `fueling/exports`   — a scoped CSV per fuel list, from the module that owns each table (P2)
 *  - `fueling/settings`  — Settings → Planned fueling's save (SP2, SETTINGS-PERMISSIONS-PLAN.md)
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
  registerFuelSettingsRoutes(router);
  registerStationRoutes(router);
  registerSpendRoutes(router);
  // FS1 — the Fuel Costs report: one range and the previous one, summed per day by network (0405).
  registerReportRoutes(router);
  registerExceptionRoutes(router);
  // FS-STRIP — the open findings per kind under the Fuel Costs cards; its own file, `exceptions.ts` is full.
  registerOpportunityRoutes(router);
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
