import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { registerSamsaraIntegrationRoutes } from "../modules/samsara/index.js";
import { registerPerformanceIntegrationRoutes } from "../modules/performance/index.js";
import { registerMcleodIntegrationRoutes } from "../modules/mcleod/index.js";
import { registerEfsSoapIntegrationRoutes } from "../modules/efs/index.js";

/**
 * Integrations admin surface, assembled from the collectors' own route registrations since the
 * P1.6 split (2026-08-27) — was one 830-line cross-collector file. Each collector owns its
 * credential/config/sync routes; this composer only holds the mount and the shared auth gate,
 * so `/api/integrations/...` paths and behavior are unchanged.
 */
export function integrationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  registerSamsaraIntegrationRoutes(router);
  registerPerformanceIntegrationRoutes(router);
  registerMcleodIntegrationRoutes(router);
  registerEfsSoapIntegrationRoutes(router);
  return router;
}
