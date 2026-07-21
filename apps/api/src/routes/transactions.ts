import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { scoreWithCascade, backfillOrg, scoreImportWithCascade } from "../services/scoring/index.js";
import { syncFuelEventsFromEfs, scoreTouched } from "../services/efsSync.js";
import { scoreDeclinedImport, scoreDeclinedOrg } from "../services/declinedScoring.js";
import { notifyForTransaction } from "../services/notifications.js";
import { runJob, jobCancelRequested } from "../services/jobs.js";
import { runEfsIngest, buildIngestSource } from "../services/efsAutoIngest.js";

/** Standard response for a background job endpoint: 202 with the job id, or 409 when one is running. */
function jobResponse(res: import("express").Response, result: { jobId: string } | { conflict: true }): void {
  if ("conflict" in result) {
    res.status(409).json(apiError("job_running", "That operation is already running — watch its progress."));
  } else {
    res.status(202).json({ ok: true, queued: true, jobId: result.jobId });
  }
}

export function transactionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Score one transaction (+ cascade). Called by the web after a fill-up is created/edited/imported.
  router.post(
    "/:id/score",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      // Ownership check before any service-role write (audit B5).
      const { data: owned } = await admin.from("fuel_transactions").select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
      if (!owned) {
        res.status(404).json(apiError("not_found", "Transaction not found"));
        return;
      }
      await scoreWithCascade(admin, env, orgId, id);

      // Best-effort high/critical email alert (never blocks scoring).
      try {
        await notifyForTransaction(admin, env, orgId, id);
      } catch {
        /* notifications are non-critical */
      }
      res.json({ ok: true });
    }),
  );

  // Score only the transactions from one import — returns immediately and scores in the BACKGROUND so
  // a large upload doesn't block the request (each row does a live Samsara reconciliation).
  router.post(
    "/score-import",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const importId = String((req.body as { importId?: string })?.importId ?? "");
      if (!importId) {
        res.status(400).json(apiError("bad_request", "importId is required"));
        return;
      }
      const { data: imp } = await admin.from("imports").select("id").eq("id", importId).eq("org_id", orgId).maybeSingle();
      if (!imp) {
        res.status(404).json(apiError("not_found", "Import not found"));
        return;
      }
      const result = await runJob(admin, orgId, "score_import", async (report) => {
        const r = await scoreImportWithCascade(admin, env, orgId, importId, report);
        await writeAudit(admin, { orgId, actorId, action: "transactions.score_import", meta: { importId, ...r } });
        return r;
      }, { requestedBy: actorId });
      jobResponse(res, result);
    }),
  );

  // Manually check the configured EFS delivery source now and ingest any reports found — the same
  // idempotent batch the background scheduler runs, through the SAME `efs_ingest` ledger slot, so a
  // manual "Check now" and a scheduled pass can never overlap (a conflict returns 409). Reports are
  // scored via the rate-limited Samsara path, so a large batch paces itself instead of hammering.
  router.post(
    "/ingest-efs",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const source = buildIngestSource(admin, env, orgId);
      if (!source) {
        res.status(400).json(apiError("not_configured", "Automated EFS ingestion is not configured (set EFS_INGEST_SOURCE)"));
        return;
      }
      const result = await runJob(
        admin,
        orgId,
        "efs_ingest",
        async () => {
          const stats = await runEfsIngest(admin, env, source);
          await writeAudit(admin, {
            orgId,
            actorId,
            action: "transactions.ingest_efs",
            meta: { found: stats.found, ingested: stats.ingested, quarantined: stats.quarantined },
          });
          return stats;
        },
        { requestedBy: actorId },
      );
      jobResponse(res, result);
    }),
  );

  // Rebuild the anomaly report from existing data — re-score every transaction with the current rules
  // (suppressions, severities, corrected location logic). Reuses stored Samsara values (skipRecon) so a
  // full rebuild is fast and doesn't make a live Samsara call per row. Runs in the background.
  router.post(
    "/rebuild",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      // Optional incremental scope: { sinceDays } re-scores only the last N days (fast — the daily path);
      // omit it for a full-history rebuild (only needed after a broad rule change).
      const parsed = z.object({ sinceDays: z.coerce.number().int().positive().max(3650).optional() }).safeParse(req.body ?? {});
      const sinceDays = parsed.success ? parsed.data.sinceDays : undefined;
      const result = await runJob(admin, orgId, "rebuild", async (report) => {
        const count = await backfillOrg(admin, env, orgId, { skipRecon: true, sinceDays }, report);
        await writeAudit(admin, { orgId, actorId, action: "transactions.rebuild", meta: { count, sinceDays: sinceDays ?? null } });
        return { count };
      }, { requestedBy: actorId });
      jobResponse(res, result);
    }),
  );

  // Score the declined attempts from one reject-report import (background — each does a live Samsara
  // location check).
  router.post(
    "/score-declined-import",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const importId = String((req.body as { importId?: string })?.importId ?? "");
      if (!importId) {
        res.status(400).json(apiError("bad_request", "importId is required"));
        return;
      }
      const result = await runJob(admin, orgId, "score_declined_import", async () => {
        const count = await scoreDeclinedImport(admin, env, orgId, importId);
        await writeAudit(admin, { orgId, actorId, action: "declined.score_import", meta: { importId, count } });
        return { count };
      }, { requestedBy: actorId });
      jobResponse(res, result);
    }),
  );

  // Re-score every declined attempt for the org (background) — for the Rejections "Rescore" button.
  router.post(
    "/rescore-declined",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const result = await runJob(admin, orgId, "rescore_declined", async () => {
        const count = await scoreDeclinedOrg(admin, env, orgId);
        await writeAudit(admin, { orgId, actorId, action: "declined.rescore", meta: { count } });
        return { count };
      }, { requestedBy: actorId });
      jobResponse(res, result);
    }),
  );

  // Backfill all transactions for the org with LIVE Samsara reconciliation + geocoding (populates
  // Repair fuel events from the faithful EFS store: re-derives merged events from efs_transactions and
  // inserts any that are missing / corrects any whose time, gallons or cost drifted from the store
  // (half-failed imports, the historical invoice-reuse merge bug, mis-restored dates). The data repair
  // is synchronous and returns exact counts; re-scoring of touched rows continues in the background
  // (live Samsara reconciliation is rate-limited).
  router.post(
    "/sync-from-efs",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const { touchedIds, ...counts } = await syncFuelEventsFromEfs(admin, orgId, actorId);
      await writeAudit(admin, { orgId, actorId, action: "transactions.sync_from_efs", meta: { ...counts, toScore: touchedIds.length } });
      res.json({ ...counts, scoringQueued: touchedIds.length });
      if (touchedIds.length) {
        void (async () => {
          const scored = await scoreTouched(admin, env, orgId, touchedIds);
          await writeAudit(admin, { orgId, actorId, action: "transactions.sync_from_efs_scored", meta: { scored } });
        })();
      }
    }),
  );

  // location confidence on historical rows). Runs in the background — geocoding is rate-limited, so a
  // large org can take a few minutes; results appear as rows are processed.
  router.post(
    "/backfill",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      // Incremental by default: reconcile only fills NEVER reconciled (new/failed rows) — this scales as
      // the fleet grows instead of re-fetching Samsara for the entire history every time. `full: true`
      // forces a complete re-reconcile (use after a detection-logic change that must re-touch old rows).
      const full = (req.body as { full?: boolean } | undefined)?.full === true;
      const result = await runJob(admin, orgId, "backfill", async (report, jobId) => {
        const count = await backfillOrg(admin, env, orgId, full ? {} : { onlyUnreconciled: true }, report, () =>
          jobCancelRequested(admin, jobId),
        );
        const canceled = await jobCancelRequested(admin, jobId);
        await writeAudit(admin, { orgId, actorId, action: "transactions.backfill", meta: { count, full, canceled } });
        return { count, full, canceled };
      }, { requestedBy: actorId });
      jobResponse(res, result);
    }),
  );

  return router;
}
