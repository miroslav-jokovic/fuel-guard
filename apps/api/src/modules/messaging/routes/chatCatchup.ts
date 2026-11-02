import { Router } from "express";
import { OFFICE_ROLES, isRecordId } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { anthropicClient } from "../../../lib/anthropic.js";
import { chatCatchup } from "../chatCatchup.js";

/**
 * POST /api/chat/:id/catchup (OFFICE-CHAT-PLAN CH12, §9.5) — a summary of the caller's unread lines in
 * one conversation (`chatCatchup.ts` has the order of its steps). The chat's own gates, plus its own
 * module (D-CHAT37): `chat_ai` is off until the platform console turns it on for a carrier, because the
 * model's tokens are that carrier's to pay for. A POST because every answer spends one of the day's
 * catch-ups and writes a ledger row; it is never fetched in the background.
 */
export function chatCatchupRouter(): Router {
  const router = Router();
  router.post(
    "/:id/catchup",
    requireAuth, requireOrg, requireModule("messages"), requireModule("chat_ai"), requireRole(...OFFICE_ROLES), requireSurface("chat"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!isRecordId(id)) { res.status(404).json(apiError("not_found", "That conversation does not exist")); return; }
      const env = getAppLocals(req).env;
      const ai = { client: env.ANTHROPIC_API_KEY ? anthropicClient(env) : null, model: env.CHAT_CATCHUP_MODEL };
      const result = await chatCatchup(getSupabaseAdmin(env), ai, req.auth!.orgId!, req.auth!.userId, id);
      if (!result.ok) { res.status(result.status).json(apiError(result.code, result.message)); return; }
      res.json(result.value);
    }),
  );
  return router;
}
