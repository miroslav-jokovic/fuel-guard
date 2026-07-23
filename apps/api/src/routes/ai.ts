import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { askData } from "../services/askData.js";

export function aiRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Natural-language question over the org's data (safe tool-calling; never raw SQL).
  router.post(
    "/ask",
    requireOrg,
    requireRole("admin", "fleet_manager", "auditor", "dispatcher", "safety_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      if (!env.ANTHROPIC_API_KEY) {
        res.status(503).json(apiError("ai_unavailable", "AI is not configured"));
        return;
      }
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const question = String((req.body as { question?: string })?.question ?? "").slice(0, 500).trim();
      if (!question) {
        res.status(400).json(apiError("bad_request", "A question is required"));
        return;
      }
      const answer = await askData(admin, env, orgId, question);
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "ai.ask", meta: { question } });
      res.json({ answer });
    }),
  );

  return router;
}
