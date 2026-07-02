import { Router } from "express";
import { anomalyTransitionSchema, type AnomalyTransition } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { verifyTransactionDetailed, type VerifyReason } from "../services/aiVerification.js";
import { scoreTransaction } from "../services/scoring.js";
import { triageOpenCases } from "../services/aiTriage.js";

const REASON_MESSAGE: Record<VerifyReason, string> = {
  disabled: "AI verification is turned off for your organization.",
  transaction_not_found: "The linked transaction could not be found.",
  below_threshold: "This anomaly isn't severe enough to auto-verify.",
  over_budget: "This month's AI token budget has been reached.",
  invalid_model_output: "The AI returned an unreadable response — please try again.",
};

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
        .select("transaction_id, rule_id, status")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!anomaly) {
        res.status(404).json(apiError("not_found", "Anomaly not found"));
        return;
      }

      // Refresh the deterministic ground truth first: re-run Samsara reconciliation + rescore. With the
      // timezone-robust stop matching, a location mismatch that was really the truck being present now
      // resolves to location_matched=true, and the engine supersedes the stale anomaly automatically.
      await scoreTransaction(admin, env, orgId, anomaly.transaction_id).catch((e) => {
        console.error("[ai-examine] rescore failed (continuing to AI):", e);
      });

      // Auto-clear: if this is a location mismatch and Samsara now positively confirms the truck was in
      // the EFS station's state, dismiss it without manual review (user-approved auto-resolution).
      const { data: txnAfter } = await admin
        .from("fuel_transactions")
        .select("samsara_location_matched")
        .eq("id", anomaly.transaction_id)
        .eq("org_id", orgId)
        .maybeSingle();
      const confirmedInState = txnAfter?.samsara_location_matched === true;
      if (anomaly.rule_id === "location_mismatch" && confirmedInState) {
        const { data: cur } = await admin.from("anomalies").select("status, version").eq("id", id).maybeSingle();
        if (cur && cur.status !== "resolved" && cur.status !== "dismissed" && cur.status !== "superseded") {
          await admin
            .from("anomalies")
            .update({
              status: "dismissed",
              resolution_note: "Auto-cleared: Samsara confirms the truck was in the EFS station's state at the fueling stop.",
              resolved_by: req.auth!.userId ?? null,
              resolved_at: new Date().toISOString(),
              version: (cur.version ?? 1) + 1,
            })
            .eq("id", id);
        }
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "anomaly.auto_cleared",
          entity: "anomalies",
          entityId: id,
          meta: { rule: "location_mismatch", basis: "samsara_location_matched" },
        });
        res.json({
          assessment: null,
          reason: "auto_cleared",
          cleared: true,
          message: "Samsara confirms the truck was in the station's state at fueling — this location mismatch was auto-cleared.",
        });
        return;
      }

      const { output: assessment, reason } = await verifyTransactionDetailed(
        admin,
        env,
        orgId,
        anomaly.transaction_id,
        { force: true, anomalyId: id },
      );
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "ai.verification_run",
        entity: "anomalies",
        entityId: id,
        meta: { reason: reason ?? "ok" },
      });
      res.json({ assessment, reason, message: reason ? REASON_MESSAGE[reason] : null });
    }),
  );

  // Auto-triage: run the AI investigator across all open cases that lack an assessment (background,
  // budget-aware) so the queue can be ranked by theft likelihood.
  router.post(
    "/triage",
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
      const actorId = req.auth!.userId;
      res.json({ ok: true, queued: true });
      void (async () => {
        try {
          const result = await triageOpenCases(admin, env, orgId);
          await writeAudit(admin, { orgId, actorId, action: "ai.triage_run", meta: { ...result } });
        } catch (e) {
          console.error("[ai-triage] failed:", e instanceof Error ? e.message : e);
        }
      })();
    }),
  );

  return router;
}
