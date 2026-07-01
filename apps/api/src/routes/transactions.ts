import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { scoreWithCascade, backfillOrg, scoreImport } from "../services/scoring.js";
import { verifyTransaction } from "../services/aiVerification.js";
import { notifyForTransaction } from "../services/notifications.js";

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

      // Best-effort AI verification (selective trigger inside the service; kill-switch + budget aware).
      if (env.ANTHROPIC_API_KEY) {
        try {
          await verifyTransaction(admin, env, orgId, id);
        } catch {
          /* AI is additive — never block scoring */
        }
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
      res.json({ ok: true, queued: true }); // respond now; scoring continues in the background
      void (async () => {
        try {
          const count = await scoreImport(admin, env, orgId, importId);
          await writeAudit(admin, { orgId, actorId, action: "transactions.score_import", meta: { importId, count } });
        } catch (e) {
          console.error("[score-import] background scoring failed:", e instanceof Error ? e.message : e);
        }
      })();
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
      res.json({ ok: true, queued: true }); // respond now; rebuild continues in the background
      void (async () => {
        try {
          const count = await backfillOrg(admin, env, orgId, { skipRecon: true });
          await writeAudit(admin, { orgId, actorId, action: "transactions.rebuild", meta: { count } });
        } catch (e) {
          console.error("[rebuild] background rebuild failed:", e instanceof Error ? e.message : e);
        }
      })();
    }),
  );

  // Backfill all transactions for the org (seed/demo + full re-score, with live Samsara reconciliation).
  router.post(
    "/backfill",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const count = await backfillOrg(admin, env, orgId);
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "transactions.backfill", meta: { count } });
      res.json({ ok: true, scored: count });
    }),
  );

  return router;
}
