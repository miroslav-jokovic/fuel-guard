import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { scoreWithCascade, backfillOrg } from "../services/scoring.js";
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

  // Backfill all transactions for the org (seed/demo + post-import bulk scoring).
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
