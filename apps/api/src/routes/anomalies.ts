import { Router } from "express";
import { anomalyTransitionSchema, type AnomalyTransition } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";


export function anomaliesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

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
