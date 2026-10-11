import type { Router } from "express";
import { discountRulesUpdateSchema } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { replaceDiscountRules } from "../discountRules.js";

/** P6.1: the discount-rules write comes off the browser and through the owner — replace-set
 *  semantics validated by the shared schema, and audited. Mounted on the shared /api/fueling router.
 *  Admin-only here until SP2 (SETTINGS-PERMISSIONS-PLAN.md), while the table's own write policy had
 *  said `dispatch` manage since 0078 (read from production pg_policies 2026-09-30). The rules are
 *  edited on Settings → Planned fueling and nowhere else, so they now ask what that screen asks —
 *  `dispatch` manage, then the screen (D-SURF5), which starts off for every role but the admin
 *  (Q-SET2). */
export function registerDiscountRuleRoutes(router: Router): void {
  router.post(
    "/discount-rules",
    requireOrg,
    requireSection("dispatch"),
    requireSurface("admin.settings.fuel-planning"),
    validateBody(discountRulesUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { rules } = res.locals.body as { rules: Parameters<typeof replaceDiscountRules>[2] };
      const result = await replaceDiscountRules(admin, orgId, rules);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.discount_rules_saved",
        entity: "fuel_discount_rules",
        meta: { rules: rules.length },
      });
      res.json({ ok: true, ...result });
    }),
  );
}
