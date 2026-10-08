import { Router } from "express";
import { cardFraudIncidentTransitionSchema, type CardFraudIncidentTransition } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { transitionCardFraudIncident } from "../transitionCardFraudIncident.js";

/**
 * Card-fraud incidents (CF2, 0438). Section `fuel` by Q-F11 (a), ruled 2026-10-08: acting on one means
 * holding or replacing the card in WEX, the fuel manager's job. So moving one needs `fuel: manage`,
 * derived from the matrix like every other gate, and a safety manager (fuel: view) sees it in the queue
 * but cannot close it.
 */
export function cardFraudIncidentsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);

  router.post(
    "/:id/transition",
    requireSection("fuel", "manage"),
    validateBody(cardFraudIncidentTransitionSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id);
      const body = res.locals.body as CardFraudIncidentTransition;
      const r = await transitionCardFraudIncident(admin, orgId, id, req.auth!.userId, body);
      if (!r.ok) {
        res.status(r.code === "not_found" ? 404 : 409).json(apiError(r.code, r.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "card_fraud.status_changed",
        entity: "card_fraud_incidents",
        entityId: id,
        meta: { from: r.from, to: r.to, disposition: body.disposition ?? null, note: body.note ?? null, version: r.version },
      });
      res.json({ ok: true, status: r.to, version: r.version });
    }),
  );

  return router;
}
