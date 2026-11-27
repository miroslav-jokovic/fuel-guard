import { Router, type Request } from "express";
import { followUpRuleSaveSchema, type FollowUpRuleSave, type FollowUpRules } from "@silvicom/shared";
import { requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { RULES_SURFACE } from "../access.js";
import { clearRuleOverride, readRuleOverrides, saveRuleOverride } from "../rules.js";
import { isSavableRuleKey, ruleViews } from "../ruleViews.js";

/**
 * `/api/follow-ups/rules` — Settings › Follow-up rules (WARNING-DESK-PLAN D-WD10). Owner ruling
 * 2026-11-26: only an admin sets the rules — which warnings count, the Nth time, the window, the
 * category and the severity. The screen's gate is `ADMIN` in the catalogue and is never offered to
 * another role; every save and reset is on the Audit page with its old and new value.
 *
 *  · `GET /` — every rule in force with its derived default, and the live Samsara configurations.
 *  · `PUT /:key` — save one rule whole (an override row).
 *  · `DELETE /:key` — back to the default (the override row goes).
 */
export function followUpRulesRouter(): Router {
  const router = Router();
  router.use(requireSection("settings", "view"), requireSurface(RULES_SURFACE));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const body: FollowUpRules = await ruleViews(adminOf(req), getAppLocals(req).env, req.auth!.orgId!, Date.now());
      res.json(body);
    }),
  );

  router.put(
    "/:key",
    validateBody(followUpRuleSaveSchema),
    asyncHandler(async (req, res) => {
      const key = String(req.params.key ?? "");
      if (!isSavableRuleKey(key)) {
        res.status(404).json(apiError("not_found", "There is no such follow-up rule."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const next = res.locals.body as FollowUpRuleSave;
      const before = (await readRuleOverrides(admin, orgId)).find((o) => o.ruleKey === key) ?? null;
      await saveRuleOverride(admin, orgId, { ruleKey: key, ...next }, req.auth!.userId, new Date());
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.follow_up_rule_saved",
        entity: "follow_up_rules",
        entityId: orgId,
        meta: { ruleKey: key, before, after: next },
      });
      res.json({ ruleKey: key, ...next });
    }),
  );

  router.delete(
    "/:key",
    asyncHandler(async (req, res) => {
      const key = String(req.params.key ?? "");
      if (!isSavableRuleKey(key)) {
        res.status(404).json(apiError("not_found", "There is no such follow-up rule."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const before = (await readRuleOverrides(admin, orgId)).find((o) => o.ruleKey === key) ?? null;
      await clearRuleOverride(admin, orgId, key);
      if (before) {
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "settings.follow_up_rule_reset",
          entity: "follow_up_rules",
          entityId: orgId,
          meta: { ruleKey: key, before },
        });
      }
      res.json({ ruleKey: key, reset: true });
    }),
  );

  return router;
}
