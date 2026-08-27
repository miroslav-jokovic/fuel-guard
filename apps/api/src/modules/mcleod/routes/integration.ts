import type { Router } from "express";
import { requireRole, requireOrg } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  getTmsIntegrationStatus,
  enableTmsIntegration,
  disableTmsIntegration,
} from "../tmsIngest.js";

/** McLeod integration config — enable/rotate/disable the on-prem agent's ingest token. Moved
 *  here from routes/integrations.ts at the P1.6 split (2026-08-27); paths unchanged. */
export function registerMcleodIntegrationRoutes(router: Router): void {
  // ── McLeod / TMS integration config (admin) ────────────────────────────────────────────────────────
  // Non-secret status for the settings screen (enabled? token issued? last sync?). Never returns the token.
  router.get(
    "/mcleod/config",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await getTmsIntegrationStatus(admin, req.auth!.orgId!, "mcleod"));
    }),
  );

  // Enable + issue a fresh ingest token (also the ROTATE path — re-calling invalidates the previous token).
  // The plaintext token is returned ONCE here for the admin to paste into the on-prem agent; only its hash
  // is stored. Audited.
  router.post(
    "/mcleod/enable",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const { token, prefix } = await enableTmsIntegration(admin, orgId, "mcleod");
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.mcleod.token_issued",
        entity: "org_integrations",
        meta: { prefix },
      });
      res.json({ enabled: true, token, prefix });
    }),
  );

  // Disable + revoke the ingest token (clears the stored hash, so any live token stops working immediately).
  router.post(
    "/mcleod/disable",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      await disableTmsIntegration(admin, orgId, "mcleod");
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.mcleod.disabled",
        entity: "org_integrations",
      });
      res.json({ enabled: false });
    }),
  );

}
