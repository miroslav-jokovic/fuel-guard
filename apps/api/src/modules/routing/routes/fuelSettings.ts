import type { Router } from "express";
import { routeFuelSettingsFormSchema } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { saveRouteFuelSettings } from "../routeFuelSettings.js";

/**
 * SP2 (SETTINGS-PERMISSIONS-PLAN.md): Settings → Planned fueling saves here. `dispatch` manage, which
 * is what the table's RLS (`route_fuel_settings_write`, 0078) always said while the page's route said
 * admin, and then the screen itself — reached from that one screen (D-SURF5), and starting off for
 * everybody but the admin until they turn it on (Q-SET2). Mounted on the shared /api/fueling router.
 */
export function registerFuelSettingsRoutes(router: Router): void {
  router.put(
    "/settings",
    requireOrg,
    requireSection("dispatch"),
    requireSurface("admin.settings.fuel-planning"),
    validateBody(routeFuelSettingsFormSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      await saveRouteFuelSettings(admin, orgId, res.locals.body);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.fuel_planning_saved",
        entity: "route_fuel_settings",
        meta: {},
      });
      res.json({ ok: true });
    }),
  );
}
