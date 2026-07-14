import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { syncVehiclesFromSamsara, NoSamsaraTokenError } from "../services/samsaraVehicleSync.js";
import { syncTrailersFromSamsara } from "../services/samsaraTrailerSync.js";
import { syncIdleEvents } from "../services/idleSync.js";
import { syncIdleCapabilities } from "../services/idleCapabilitySync.js";
import { syncDriversFromSamsara } from "../services/samsaraDriverSync.js";
import { runSamsaraDiagnostics } from "../services/samsaraDiagnostics.js";
import { syncDriverScores, syncRecentDriverScoreWeeks } from "../services/driverScoreSync.js";
import { snapshotSettledWeeks } from "../services/driverPerformanceSnapshot.js";
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
        // Refresh the current week's driver-performance component scores (Safety + Efficiency). Best-effort.
        try {
          const dp = await syncDriverScores(admin, env, orgId);
          console.log(`[integrations] driver-score sync: ${dp.upserted} rows (safety=${dp.safetyOk} efficiency=${dp.efficiencyOk})`);
        } catch (e) {
          console.error("[integrations] driver-score sync failed:", e instanceof Error ? e.message : e);
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
        // Phase 2: learn each truck's idle capability (APU / ECU-optimized / continuous) from engineStates,
        // so the driver score is fair. Best-effort + logged; never fails the event sync above.
        let cap = { vehicles: 0, learned: 0 };
        try {
          cap = await syncIdleCapabilities(admin, env, orgId);
          console.log(`[integrations] idle capability: ${cap.learned}/${cap.vehicles} trucks classified`);
        } catch (e) {
          console.error("[integrations] idle capability learning failed:", e instanceof Error ? e.message : e);
        }
        await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "integration.samsara.idle_synced", entity: "idle_events", meta: { ...result, capabilityLearned: cap.learned } });
        await finishJob(admin, jobId, { status: "done", stats: { ...result, capabilityLearned: cap.learned } });
        res.json({ ...result, capabilityLearned: cap.learned });
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

  // Refresh the current week's driver-performance component scores from Samsara (admin + fleet_manager).
  router.post(
    "/samsara/sync-driver-scores",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(env);
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "sync_driver_scores", { requestedBy: req.auth!.userId });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("job_running", "A driver-score sync is already running."));
          return;
        }
        throw e;
      }
      try {
        const result = await syncRecentDriverScoreWeeks(admin, env, orgId);
        // Idle feeds the grade too — refresh it here so "Sync scores" makes the whole page current.
        try {
          await syncIdleEvents(admin, env, orgId);
        } catch (e) {
          console.error("[integrations] driver-score idle refresh failed:", e instanceof Error ? e.message : e);
        }
        const cur = result.results[0];
        const summary = { weekStart: cur?.weekStart ?? null, weeks: result.weeks, drivers: cur?.drivers ?? 0, upserted: result.totalUpserted, safetyOk: cur?.safetyOk ?? false, efficiencyOk: cur?.efficiencyOk ?? false };
        await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "integration.samsara.driver_scores_synced", entity: "driver_scores", meta: summary });
        await finishJob(admin, jobId, { status: "done", stats: summary });
        res.json(summary);
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        if (e instanceof NoSamsaraTokenError) {
          res.status(400).json(apiError("no_samsara_token", e.message));
          return;
        }
        console.error("[integrations] samsara driver-score sync failed:", e);
        res.status(502).json(apiError("samsara_sync_failed", "Could not sync driver scores from Samsara"));
      }
    }),
  );

  // Freeze all settled weeks into the rewards ledger (admin). Idempotent.
  router.post(
    "/driver-performance/snapshot",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(env);
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "snapshot_driver_week", { requestedBy: req.auth!.userId });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("job_running", "A snapshot is already running."));
          return;
        }
        throw e;
      }
      try {
        const result = await snapshotSettledWeeks(admin, env, orgId);
        await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "driver_performance.snapshot", entity: "driver_performance_weeks", meta: { weeksFrozen: result.weeksFrozen, rowsWritten: result.rowsWritten } });
        await finishJob(admin, jobId, { status: "done", stats: { weeksFrozen: result.weeksFrozen.length, rowsWritten: result.rowsWritten } });
        res.json(result);
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        console.error("[integrations] driver-performance snapshot failed:", e);
        res.status(502).json(apiError("snapshot_failed", "Could not snapshot driver performance"));
      }
    }),
  );


  return router;
}
