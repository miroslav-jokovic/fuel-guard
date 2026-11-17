import { Router, type Request } from "express";
import { lumperReminderSettingsSchema, type LumperReminderSettings } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { readLumperReminderStatus, readLumperRemindersOn, saveLumperRemindersOn } from "./lumperReminders.js";

/**
 * `/api/lumper-reminders/settings` — whether the daily lumper reminder is sent (LUMPER-REVISED-RC-PLAN
 * D-LRC9: off through the silent weeks, switched on by a person on the evidence).
 *
 * The SCREEN that saves it is Settings › Notifications, beside who receives each lumper alert, so the gate
 * is that screen's pair (`settings: manage`, then `admin.settings.notifications`, D-SURF5) — the same as
 * home time's thresholds (`roster/homeTime/settingsRoutes.ts`). The Lumper fees page reads the switch
 * through its own list, behind its own gate.
 *
 * Every change is on the Audit page with the old and the new answer: "when were the reminders turned
 * on, and by whom" is answered nowhere else.
 */
export function lumperReminderSettingsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("dispatch"), requireSection("settings"), requireSurface("admin.settings.notifications"));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await readLumperReminderStatus(adminOf(req), req.auth!.orgId!));
    }),
  );

  router.put(
    "/",
    validateBody(lumperReminderSettingsSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const next = res.locals.body as LumperReminderSettings;
      const before = await readLumperRemindersOn(admin, orgId);
      await saveLumperRemindersOn(admin, orgId, req.auth!.userId, next.remindersOn, new Date());
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.lumper_reminders_saved",
        entity: "lumper_reminder_settings",
        entityId: orgId,
        meta: { before: { remindersOn: before }, after: next },
      });
      res.json(await readLumperReminderStatus(admin, orgId));
    }),
  );

  return router;
}
