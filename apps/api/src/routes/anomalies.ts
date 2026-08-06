import { Router } from "express";
import { anomalyTransitionSchema, type AnomalyTransition } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { loadEntityRiskContext } from "../services/entityRisk.js";
import { dispatchJob } from "../services/queue/dispatch.js";


export function anomaliesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Entity-intelligence Phase 1 — derived-on-read risk snapshot for the case's driver/vehicle/card.
  router.get(
    "/:id/risk-context",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { data: anom } = await admin
        .from("anomalies").select("id, transaction_id").eq("id", id).eq("org_id", orgId).maybeSingle();
      if (!anom) { res.status(404).json(apiError("not_found", "Anomaly not found")); return; }
      let entities: { driverId?: string | null; vehicleId?: string | null; cardRef?: string | null } = {};
      if (anom.transaction_id) {
        const { data: txn } = await admin
          .from("fuel_transactions").select("driver_id, vehicle_id, card_ref")
          .eq("id", anom.transaction_id as string).maybeSingle();
        if (txn) entities = { driverId: txn.driver_id as string | null, vehicleId: txn.vehicle_id as string | null, cardRef: txn.card_ref as string | null };
      }
      res.json(await loadEntityRiskContext(admin, orgId, entities));
    }),
  );

  // Entity-intelligence Phase 2 — the persisted retrospective pattern report for a case.
  router.get(
    "/:id/pattern-report",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { data } = await admin
        .from("case_pattern_reports")
        .select("report, lookback_days, generated_at")
        .eq("anomaly_id", id).eq("org_id", orgId).maybeSingle();
      if (!data) { res.status(404).json(apiError("not_found", "No pattern report for this case yet")); return; }
      res.json(data);
    }),
  );

  // On-demand sweep (reviewer button; also covers rebuild-created cases, which don't auto-sweep).
  router.post(
    "/:id/sweep",
    requireOrg,
    requireRole("admin", "fleet_manager", "safety_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { data: anom } = await admin
        .from("anomalies").select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
      if (!anom) { res.status(404).json(apiError("not_found", "Anomaly not found")); return; }
      // Small enough to run synchronously via the job ledger when free; per-anomaly dedup key.
      const result = await dispatchJob(admin, env, "pattern_sweep", {
        orgId, payload: { anomalyId: id }, dedupKey: `sweep:${id}`, requestedBy: req.auth!.userId,
      });
      if ("conflict" in result) { res.status(409).json(apiError("job_running", "A sweep for this case is already running")); return; }
      res.status(202).json({ ok: true, jobId: result.jobId });
    }),
  );

  // Workflow transition with optimistic concurrency (audit H6) + audit trail (H9).
  router.post(
    "/:id/transition",
    requireOrg,
    requireRole("admin", "fleet_manager", "safety_manager"),
    validateBody(anomalyTransitionSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { status, note, disposition, version } = res.locals.body as AnomalyTransition;

      const { data: cur } = await admin
        .from("anomalies")
        .select("id, status, version")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!cur) {
        res.status(404).json(apiError("not_found", "Anomaly not found"));
        return;
      }
      if (cur.version !== version) {
        res.status(409).json(apiError("conflict", "This anomaly was updated by someone else; refresh and retry"));
        return;
      }

      const patch: Record<string, unknown> = {
        status,
        version: cur.version + 1,
        resolution_note: note ?? null,
        assigned_to: req.auth!.userId,
      };
      if (status === "resolved" || status === "dismissed") {
        patch.resolved_by = req.auth!.userId;
        patch.resolved_at = new Date().toISOString();
        // Ground-truth outcome for the accuracy program. Only recorded on close; a reopened case that is
        // later re-closed overwrites it (latest reviewer judgment wins).
        if (disposition) {
          patch.disposition = disposition;
          patch.disposition_by = req.auth!.userId;
          patch.disposition_at = new Date().toISOString();
        }
      }

      // Re-assert the version in the WHERE clause to defeat a race.
      const { data: upd } = await admin
        .from("anomalies")
        .update(patch)
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("version", version)
        .select("id")
        .maybeSingle();
      if (!upd) {
        res.status(409).json(apiError("conflict", "Concurrent update — refresh and retry"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "anomaly.status_changed",
        entity: "anomalies",
        entityId: id,
        meta: { from: cur.status, to: status, disposition: disposition ?? null },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
