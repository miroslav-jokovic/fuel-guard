import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { scoreWithCascade } from "../services/scoring/index.js";
import { syncFuelEventsFromEfs, scoreTouched } from "../modules/efs/services/efsSync.js";
import { notifyForTransaction } from "../services/notifications.js";
import { dispatchJob } from "../services/queue/dispatch.js";
import { buildIngestSource } from "../modules/efs/services/efsAutoIngest.js";
import {
  startJob, finishJob, startJobHeartbeat, scoringDedupKey, JobConflictError,
} from "../services/jobs.js";
import { ingestReport } from "../modules/efs/services/efsIngest.js";

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
      // P0-3: a single-fill score is a scoring WRITER like any other — it takes the per-org scoring
      // mutex so it can never interleave with a rebuild/backfill/import scoring the same rows. Kept
      // synchronous (the response contract is unchanged); a conflict is a clean 409, and the fill
      // will be scored by whatever run currently owns the org anyway.
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "score_txn", {
          dedupKey: scoringDedupKey(orgId), requestedBy: req.auth!.userId,
        });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("scoring_busy", "A scoring run is active for this organization — the fill will be scored by it; try again in a moment if you need a manual re-score."));
          return;
        }
        throw e;
      }
      try {
        await scoreWithCascade(admin, env, orgId, id);
        await finishJob(admin, jobId, { status: "done", stats: { txnId: id } });
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        throw e;
      }

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
      const result = await dispatchJob(admin, env, "score_import", {
        orgId, payload: { importId, actorId }, requestedBy: actorId,
      });
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
      const result = await dispatchJob(admin, env, "efs_ingest", {
        orgId, payload: { orgId, actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // P0-1 (2026-08 audit): the browser upload path. The web app used to parse the file AND write
  // fuel_transactions/efs_transactions directly from the browser with only the external_ref guard —
  // bypassing the transaction-id and content-identity dedup that the server ingest runs, i.e. the
  // exact twin-minting class of the duplication incident. The client now parses (for the review
  // preview) and POSTs the raw rows here; the server runs the SAME ingestReport pipeline as the
  // email/SOAP channels — one write path, one set of identity guards. Scoring is dispatched as the
  // background score_import/score_declined_import jobs (as the client did before), under the per-org
  // scoring mutex.
  router.post(
    "/import-report",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const parsed = z
        .object({
          filename: z.string().min(1).max(300),
          source: z.enum(["xlsx", "csv"]),
          fileHash: z.string().regex(/^[0-9a-f]{64}$/),
          headers: z.array(z.string()).min(1).max(300),
          rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(50_000),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Invalid import payload"));
        return;
      }
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "efs_ingest", {
          dedupKey: scoringDedupKey(orgId), requestedBy: actorId,
        });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("scoring_busy", "An import or scoring run is already active for this organization — try again when it finishes."));
          return;
        }
        throw e;
      }
      const stopHeartbeat = startJobHeartbeat(admin, jobId);
      try {
        const result = await ingestReport(
          admin,
          env,
          {
            orgId,
            requestedBy: actorId,
            source: parsed.data.source,
            filename: parsed.data.filename,
            fileHash: parsed.data.fileHash,
            headers: parsed.data.headers,
            rows: parsed.data.rows,
            channel: "manual",
          },
          // Scoring is deferred to its own jobs below — running it inline would hold this HTTP
          // request (and the scoring mutex) for the whole live-recon pass of a large upload.
          { scoreImport: async () => {}, scoreDeclined: async () => {} },
        );
        await finishJob(admin, jobId, {
          status: "done",
          stats: { kind: result.kind, newFuel: result.newFuel, enriched: result.enrichedFuel ?? 0, newDeclined: result.newDeclined, alreadyImported: result.alreadyImported },
        });
        // Background scoring, exactly what the browser used to trigger itself. A conflict (another
        // scoring run took the mutex meanwhile) is fine: the nightly reconcile scores never-reconciled
        // rows, so nothing is lost — only delayed.
        if (result.importId && result.newFuel > 0) {
          void dispatchJob(admin, env, "score_import", { orgId, payload: { importId: result.importId, actorId }, requestedBy: actorId });
        }
        if (result.importId && result.newDeclined > 0) {
          void dispatchJob(admin, env, "score_declined_import", { orgId, payload: { importId: result.importId, actorId }, requestedBy: actorId });
        }
        res.json(result);
      } catch (e) {
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        throw e;
      } finally {
        stopHeartbeat();
      }
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
      const result = await dispatchJob(admin, env, "rebuild", {
        orgId, payload: { sinceDays, actorId }, requestedBy: actorId,
      });
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
      const result = await dispatchJob(admin, env, "score_declined_import", {
        orgId, payload: { importId, actorId }, requestedBy: actorId,
      });
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
      const result = await dispatchJob(admin, env, "rescore_declined", {
        orgId, payload: { actorId }, requestedBy: actorId,
      });
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
      // P0-3: this route both WRITES fills (repair inserts/updates) and SCORES them — previously with
      // no lock at all, so two clicks (or a click during the nightly) ran concurrent repair+scoring.
      // It now holds the per-org scoring mutex for the whole repair AND the background re-score, so
      // the slot releases only when everything it touched is consistent.
      let jobId: string;
      try {
        jobId = await startJob(admin, orgId, "efs_store_sync", {
          dedupKey: scoringDedupKey(orgId), requestedBy: actorId,
        });
      } catch (e) {
        if (e instanceof JobConflictError) {
          res.status(409).json(apiError("scoring_busy", "A scoring/repair run is already active for this organization — try again when it finishes."));
          return;
        }
        throw e;
      }
      const stopHeartbeat = startJobHeartbeat(admin, jobId);
      let counts: Omit<Awaited<ReturnType<typeof syncFuelEventsFromEfs>>, "touchedIds">;
      let touchedIds: string[];
      try {
        ({ touchedIds, ...counts } = await syncFuelEventsFromEfs(admin, orgId, actorId));
        await writeAudit(admin, { orgId, actorId, action: "transactions.sync_from_efs", meta: { ...counts, toScore: touchedIds.length } });
      } catch (e) {
        stopHeartbeat();
        await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
      res.json({ ...counts, scoringQueued: touchedIds.length });
      void (async () => {
        try {
          const scored = touchedIds.length ? await scoreTouched(admin, env, orgId, touchedIds) : 0;
          if (touchedIds.length) {
            await writeAudit(admin, { orgId, actorId, action: "transactions.sync_from_efs_scored", meta: { scored } });
          }
          await finishJob(admin, jobId, { status: "done", stats: { ...counts, scored } });
        } catch (e) {
          await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        } finally {
          stopHeartbeat();
        }
      })();
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
      const result = await dispatchJob(admin, env, "backfill", {
        orgId, payload: { full, actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  return router;
}
