import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { syncVehiclesFromSamsara, NoSamsaraTokenError } from "../services/samsaraVehicleSync.js";
import { syncTrailersFromSamsara } from "../services/samsaraTrailerSync.js";
import { syncIdleEvents } from "../services/idleSync.js";
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
        // The identity sync also covers trailers (and runs the reefer↔tractor GPS co-location pairing). Kept
        // in the same action so "Sync now" does everything the card promises. Non-fatal + logged.
        try {
          const tr = await syncTrailersFromSamsara(admin, env, orgId);
          console.log(`[integrations] trailer sync: ${tr.total} trailers, ${tr.paired} paired`);
        } catch (e) {
          console.error("[integrations] trailer sync (within vehicle sync) failed:", e instanceof Error ? e.message : e);
        }
        // Pull idling events (idle tracking + driver fuel scoring). Best-effort + logged; a 401 = missing
        // "Read Idling" token scope.
        try {
          const idle = await syncIdleEvents(admin, env, orgId);
          console.log(`[integrations] idle sync: ${idle.fetched} events`);
        } catch (e) {
          console.error("[integrations] idle sync failed:", e instanceof Error ? e.message : e);
        }
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

  // Sync the org's trailers (reefer assets) from Samsara into the trailers table (admin).
  router.post(
    "/samsara/sync-trailers",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(env);
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "sync_trailers", { requestedBy: req.auth!.userId });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("job_running", "A trailer sync is already running."));
          return;
        }
        throw e;
      }
      try {
        const result = await syncTrailersFromSamsara(admin, env, orgId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "integration.samsara.trailers_synced",
          entity: "trailers",
          meta: { total: result.total, created: result.created, updated: result.updated, paired: result.paired },
        });
        await finishJob(admin, jobId, { status: "done", stats: { ...result } });
        res.json(result);
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        if (e instanceof NoSamsaraTokenError) {
          res.status(400).json(apiError("no_samsara_token", e.message));
          return;
        }
        console.error("[integrations] samsara trailer sync failed:", e);
        res.status(502).json(apiError("samsara_sync_failed", "Could not sync trailers from Samsara"));
      }
    }),
  );

  // Pull idling events from Samsara into idle_events (idle tracking + driver fuel scoring).
  router.post(
    "/samsara/sync-idle",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(env);
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "sync_idle", { requestedBy: req.auth!.userId });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("job_running", "An idle sync is already running."));
          return;
        }
        throw e;
      }
      try {
        const result = await syncIdleEvents(admin, env, orgId);
        await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "integration.samsara.idle_synced", entity: "idle_events", meta: { ...result } });
        await finishJob(admin, jobId, { status: "done", stats: { ...result } });
        res.json(result);
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        if (e instanceof NoSamsaraTokenError) {
          res.status(400).json(apiError("no_samsara_token", e.message));
          return;
        }
        console.error("[integrations] samsara idle sync failed:", e);
        res.status(502).json(apiError("samsara_sync_failed", "Could not sync idling events from Samsara"));
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
