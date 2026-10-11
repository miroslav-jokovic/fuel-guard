import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { writeAudit } from "../../../lib/audit.js";
import { askData } from "../askData.js";

export function aiRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Natural-language question over the org's data (safe tool-calling; never raw SQL).
  //
  // Fuel `view`, by the owner's ruling Q-SET14 (b), 2026-09-30 (SETTINGS-PERMISSIONS-PLAN.md §5). The
  // hand-written list this replaced equalled hazmat/view by coincidence (Q-SURF7), so an org granting a
  // recruiter HazmatGuard would have handed them the assistant too. What the assistant answers with is
  // fuel data — `askData` reads fuel transactions, anomalies, declines and fuel events for almost every
  // answer — so an org that narrows Fuel narrows Ask AI with it. The one role this adds is the
  // accountant, who already reads the same rows on the fuel-spend pages.
  //
  // And the screen's own answer (Q-SET15, owner 2026-09-30): Ask AI starts OFF for every role but the
  // admin until the page is rebuilt per role, and an admin turns it on per role or per person. The
  // link hides by the same answer; without this gate a hidden page's endpoint would still answer.
  router.post(
    "/ask",
    requireOrg,
    requireSection("fuel", "view"),
    requireSurface("ask-ai"),
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
