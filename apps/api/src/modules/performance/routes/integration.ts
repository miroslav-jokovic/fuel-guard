import type { Router } from "express";
import { requireRole, requireOrg } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { dispatchJob, jobResponse } from "../../../queue/dispatch.js";
import { validateBody } from "../../../lib/http.js";
import { writeAudit } from "../../../lib/audit.js";
import { performanceSettingsFormSchema, rolesThatManage } from "@silvicom/shared";
import { savePerformanceSettings } from "../performanceSettings.js";

/** The settled-week snapshot trigger — performance's own admin surface, split out of
 *  routes/integrations.ts at P1.6 (2026-08-27). Path unchanged. */
export function registerPerformanceIntegrationRoutes(router: Router): void {
  // Freeze all settled weeks into the rewards ledger (admin). Idempotent; DB-only (no vendor call).
  router.post(
    "/driver-performance/snapshot",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "snapshot_driver_week", {
        orgId: req.auth!.orgId!,
        payload: { actorId },
        requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );


  // P6.1: the settings write comes off the browser and through the owner. Admin only, exactly
  // as the dps_write RLS policy (0053) always said.
  router.post(
    "/driver-performance/settings",
    requireOrg,
    requireRole(...rolesThatManage("admin")),
    validateBody(performanceSettingsFormSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      await savePerformanceSettings(admin, orgId, res.locals.body);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.driver_performance_saved",
        entity: "driver_performance_settings",
        meta: {},
      });
      res.json({ ok: true });
    }),
  );
}
