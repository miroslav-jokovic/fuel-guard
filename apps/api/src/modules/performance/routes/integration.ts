import type { Router } from "express";
import { requireRole, requireOrg } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { dispatchJob, jobResponse } from "../../../queue/dispatch.js";

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

}
