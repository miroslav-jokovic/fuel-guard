import { Router } from "express";
import { requireAuth, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { latestJob, lastDoneJob, type JobKind } from "../services/jobs.js";

const KNOWN_KINDS = new Set<JobKind>([
  "rebuild",
  "backfill",
  "score_import",
  "score_declined_import",
  "rescore_declined",
  "sync_vehicles",
  "sync_trailers",
  "sync_from_efs",
  "sync_stats",
  "sync_identity",
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

  return router;
}
