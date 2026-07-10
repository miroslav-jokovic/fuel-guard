import { Router } from "express";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { latestJob, lastDoneJob, requestJobCancel, type JobKind } from "../services/jobs.js";

const KNOWN_KINDS = new Set<JobKind>([
  "rebuild",
  "backfill",
  "score_import",
  "score_declined_import",
  "rescore_declined",
  "sync_vehicles",
  "sync_trailers",
  "sync_idle",
  "sync_stats",
  "nightly_reconcile",
  "efs_ingest",
]);

export function jobsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Latest job of a kind (status/progress) + the last successful one (freshness) — drives useJob.
  router.get(
    "/latest",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const kind = String(req.query.kind ?? "") as JobKind;
      if (!KNOWN_KINDS.has(kind)) {
        res.status(400).json(apiError("bad_request", "Unknown or missing job kind"));
        return;
      }
      const [latest, lastDone] = await Promise.all([latestJob(admin, orgId, kind), lastDoneJob(admin, orgId, kind)]);
      res.json({ latest, lastDone });
    }),
  );

  // Cooperatively cancel the active job of a kind (e.g. a long re-sync). The job stops at its next chunk
  // boundary; rows already processed are committed + checkpointed, so a later re-run resumes the remainder.
  router.post(
    "/cancel",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const kind = String((req.body as { kind?: string } | undefined)?.kind ?? req.query.kind ?? "") as JobKind;
      if (!KNOWN_KINDS.has(kind)) {
        res.status(400).json(apiError("bad_request", "Unknown or missing job kind"));
        return;
      }
      const flagged = await requestJobCancel(admin, orgId, kind);
      res.json({ canceled: flagged });
    }),
  );

  return router;
}
