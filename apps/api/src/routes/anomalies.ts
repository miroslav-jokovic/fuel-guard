import { Router } from "express";
import { anomalyTransitionSchema, type AnomalyTransition } from "@fleetguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { verifyTransaction } from "../services/aiVerification.js";

export function anomaliesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Workflow transition with optimistic concurrency (audit H6) + audit trail (H9).
  router.post(
    "/:id/transition",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    validateBody(anomalyTransitionSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { status, note, version } = res.locals.body as AnomalyTransition;

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
        meta: { from: cur.status, to: status },
      });
      res.json({ ok: true });
    }),
  );

  // On-demand Claude verification for a flagged transaction (docs/07 §6).
  router.post(
    "/:id/ai-examine",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      if (!env.ANTHROPIC_API_KEY) {
        res.status(503).json(apiError("ai_unavailable", "AI verification is not configured"));
        return;
      }
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { data: anomaly } = await admin
        .from("anomalies")
        .select("transaction_id")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!anomaly) {
        res.status(404).json(apiError("not_found", "Anomaly not found"));
        return;
      }
      const assessment = await verifyTransaction(admin, env, orgId, anomaly.transaction_id, {
        force: true,
        anomalyId: id,
      });
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "ai.verification_run",
        entity: "anomalies",
        entityId: id,
      });
      res.json({ assessment });
    }),
  );

  return router;
}
