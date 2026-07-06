import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { syncVehiclesFromSamsara, NoSamsaraTokenError } from "../services/samsaraVehicleSync.js";
import { syncDriversFromSamsara } from "../services/samsaraDriverSync.js";
import { runSamsaraDiagnostics } from "../services/samsaraDiagnostics.js";
import { startJob, finishJob, JobConflictError } from "../services/jobs.js";

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
      const admin = getSupabaseAdmin(env);
      // Record the sync as a job so the UI shows freshness + refuses overlapping runs (manual + scheduled).
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "sync_vehicles", { requestedBy: req.auth!.userId });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("job_running", "A Samsara sync is already running — watch its progress."));
          return;
        }
        throw e;
      }
      try {
        // Sync drivers first so samsara_driver_id is populated before the vehicle assignment step.
        try { await syncDriversFromSamsara(admin, env, orgId); } catch { /* non-fatal */ }
        const result = await syncVehiclesFromSamsara(admin, env, orgId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "integration.samsara.vehicles_synced",
          entity: "vehicles",
          meta: { total: result.total, created: result.created, updated: result.updated },
        });
        await finishJob(admin, jobId, { status: "done", stats: { total: result.total, created: result.created, updated: result.updated, assigned: result.assigned } });
        res.json(result);
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
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

  // Diagnostics: probe each Samsara endpoint and report status/counts/sample (admin, read-only).
  router.post(
    "/samsara/diagnostics",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      try {
        const report = await runSamsaraDiagnostics(admin, env, req.auth!.orgId!);
        res.json(report);
      } catch (e) {
        console.error("[integrations] diagnostics failed:", e);
        res.status(502).json(apiError("diagnostics_failed", "Could not run Samsara diagnostics"));
      }
    }),
  );

  return router;
}
