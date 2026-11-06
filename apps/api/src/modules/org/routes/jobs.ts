import { Router } from "express";
import { callerCanManage, JOB_KIND_CATALOGUE, jobKindEntry, type JobArea } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { failedJobs, latestJob, lastDoneJob, requestJobCancel, type JobKind } from "../jobs.js";
import { queueMetrics } from "../../../queue/metrics.js";

/**
 * Every kind the API runs, read from the shared catalogue (`jobKindCatalogue.ts`), which `jobKindCatalogue.test.ts`
 * holds equal to `JobKind` both ways. This was a hand list of 20 that missed `efs_store_sync`, so Settings › Data &
 * sync's card for it answered 400 on every load (three times per page view, Q-AD41 (b) 2026-11-06), and FleetPal's
 * and Med-Stop's settings cards the same.
 */
const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.keys(JOB_KIND_CATALOGUE));

/**
 * Who may read a kind's latest run. `/latest` returns the whole job row — payload, stats and error text — so widening
 * it from 20 kinds to every kind would have shown any org member, a dispatcher or a driver-facing role, rows that
 * name an ad campaign or a Meta lead, a Med-Stop drug-test sync, a driver-file binder or McLeod financial totals.
 *
 * Ruled from the catalogue's own `area`, not a second list of kinds: the 20 kinds this route always served are
 * exactly the fuel, Samsara (telematics) and EFS areas, read by fuel pages any member can open, so those areas stay
 * open to `requireOrg` as before (and gain their nine siblings, the same class of sync status). Every other area
 * needs the Settings section, the gate `/failed` already uses for the same rows. A new kind takes its area's rule.
 */
const OPEN_AREAS: ReadonlySet<JobArea> = new Set<JobArea>(["fuel", "telematics", "efs"]);
const openToEveryMember = (kind: string): boolean => OPEN_AREAS.has(jobKindEntry(kind).area);

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
      if (!openToEveryMember(kind) && !callerCanManage(req.auth!.role ?? null, "settings", req.auth!.sections ?? null)) {
        res.status(403).json(apiError("forbidden", "Insufficient role"));
        return;
      }
      const [latest, lastDone] = await Promise.all([latestJob(admin, orgId, kind), lastDoneJob(admin, orgId, kind)]);
      res.json({ latest, lastDone });
    }),
  );

  // Failed terminal jobs — operator visibility for jobs that exhausted retries or were explicitly parked.
  router.get(
    "/failed",
    requireOrg,
    requireSection("settings"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const limit = Number(req.query.limit ?? 50);
      res.json(await failedJobs(admin, req.auth!.orgId!, Number.isFinite(limit) ? limit : 50));
    }),
  );

  // Cooperatively cancel the active job of a kind (e.g. a long re-sync). The job stops at its next chunk
  // boundary; rows already processed are committed + checkpointed, so a later re-run resumes the remainder.
  router.post(
    "/cancel",
    requireOrg,
    requireSection("settings"),
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

  // Queue health for the caller's org (plan A1 / WQ4 validation): backlog depth, oldest-queued age, and a
  // 24h failed count, per kind. Read-only; drives the cutover canary check + an ops freshness view.
  router.get(
    "/queue-metrics",
    requireOrg,
    requireSection("settings"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const metrics = await queueMetrics(admin, req.auth!.orgId!);
      res.json({ mode: env.JOB_EXECUTION_MODE, ...metrics });
    }),
  );

  return router;
}
