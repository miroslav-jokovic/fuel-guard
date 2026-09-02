import type { Router } from "express";
import { discountRulesUpdateSchema } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { replaceDiscountRules } from "../discountRules.js";

/** P6.1: the discount-rules write comes off the browser and through the owner — replace-set
 *  semantics validated by the shared schema, admin-gated exactly as the fuel_discount_write
 *  RLS policy (0058) always said, and audited. Mounted on the shared /api/fueling router. */
export function registerDiscountRuleRoutes(router: Router): void {
  router.post(
    "/discount-rules",
    requireOrg,
    requireSection("admin"),
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
