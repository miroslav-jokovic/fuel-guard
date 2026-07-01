import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { syncVehiclesFromSamsara, NoSamsaraTokenError } from "../services/samsaraVehicleSync.js";
import { syncDriversFromSamsara } from "../services/samsaraDriverSync.js";

export function integrationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Sync the fleet's powered vehicles (trucks only) from Samsara into the vehicles table (admin).
  router.post(
    "/samsara/sync-vehicles",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      try {
        const admin = getSupabaseAdmin(env);
        const result = await syncVehiclesFromSamsara(admin, env, orgId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "integration.samsara.vehicles_synced",
          entity: "vehicles",
          meta: { total: result.total, created: result.created, updated: result.updated },
        });
        res.json(result);
      } catch (e) {
        if (e instanceof NoSamsaraTokenError) {
          res.status(400).json(apiError("no_samsara_token", e.message));
          return;
        }
        console.error("[integrations] samsara vehicle sync failed:", e);
        res.status(502).json(apiError("samsara_sync_failed", "Could not sync vehicles from Samsara"));
      }
    }),
  );

  // Sync the org's drivers from Samsara into the drivers table (admin).
  router.post(
    "/samsara/sync-drivers",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      try {
        const admin = getSupabaseAdmin(env);
        const result = await syncDriversFromSamsara(admin, env, orgId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "integration.samsara.drivers_synced",
          entity: "drivers",
          meta: { total: result.total, created: result.created, updated: result.updated },
        });
        res.json(result);
      } catch (e) {
        if (e instanceof NoSamsaraTokenError) {
          res.status(400).json(apiError("no_samsara_token", e.message));
          return;
        }
        console.error("[integrations] samsara driver sync failed:", e);
        res.status(502).json(apiError("samsara_sync_failed", "Could not sync drivers from Samsara"));
      }
    }),
  );

  return router;
}
