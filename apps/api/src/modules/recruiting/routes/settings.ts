import { Router, type Request, type Response } from "express";
import { recruitingSettingsSchema, type RecruitingSettings } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { recruitingSettingsView, saveRecruitingSettings } from "../recruitingSettings.js";

/**
 * Settings → Recruiting's link lifetime and reminder (APPLICATION-FLOW-V2-PLAN.md S2, Q-AW41).
 *
 * The recruitment section's own doors, as the Representatives and examiners beside it on the same page:
 * `view` reads, `manage` writes. The page sits under Settings and the admin keeps it (owner, 2026-09-28),
 * but the gate is the section matrix's, never a role literal. The body is the whole set, validated by the
 * contract — bounds and "a reminder that is on comes before the link dies" — and 0379 checks it again.
 */
export function recruitmentSettingsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/settings",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await recruitingSettingsView(admin, req.auth!.orgId!));
    }),
  );

  router.put(
    "/settings",
    requireOrg,
    requireSection("recruitment"),
    validateBody(recruitingSettingsSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const saved = await saveRecruitingSettings(admin, orgId, req.auth!.userId, res.locals.body as RecruitingSettings);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.settings_updated",
        entity: "recruiting_settings",
        entityId: orgId,
        // Both sides, so the log answers "who made links last three days, and what were they before".
        meta: { from: saved.before, to: saved.view.settings },
      });
      res.json(saved.view);
    }),
  );

  return router;
}
