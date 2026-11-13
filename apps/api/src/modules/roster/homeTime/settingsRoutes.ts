import { Router, type Request } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { homeTimeSettingsSchema, type HomeTimeSettings } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { readHomeTimeSettings } from "./homeTime.js";

/**
 * `/api/roster/home-time/settings` — when the three home-time alerts fire (HOME-TIME-PLAN D-HT12, HT5).
 *
 * The table is the roster's (`home_time_settings`, 0597), so its write lives here; the SCREEN that
 * saves it is Settings › Notifications, so the gate is that screen's pair (`settings: manage`, then
 * `admin.settings.notifications`, D-SURF5) and not the Dispatch board's. The board reads the same
 * numbers through `GET /api/roster/home-time`, behind its own gate.
 *
 * Mounted by `rosterHomeTimeRouter` at `/settings`, AHEAD of the board's router, so nothing under that
 * path is ever answered by the board's gate.
 *
 * The save writes the WHOLE row — all three numbers, on the table's primary key — so it is an
 * insert-or-replace, never a column-group update. The audit row carries the old and the new numbers:
 * "the overstay alert used to come after two hours" is answered nowhere else.
 */
async function saveHomeTimeSettings(admin: SupabaseClient, orgId: string, actorId: string, s: HomeTimeSettings, now: Date): Promise<void> {
  const { error } = await admin.from("home_time_settings").upsert(
    {
      org_id: orgId,
      return_due_hours: s.returnDueHours,
      overdue_after_hours: s.overdueAfterHours,
      truck_limit_days: s.truckLimitDays,
      updated_by: actorId,
      updated_at: now.toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw new Error(`home_time_settings: ${error.message}`);
}

export function homeTimeSettingsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireSection("settings"), requireSurface("admin.settings.notifications"));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json({ settings: await readHomeTimeSettings(adminOf(req), req.auth!.orgId!) });
    }),
  );

  router.put(
    "/",
    validateBody(homeTimeSettingsSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const next = res.locals.body as HomeTimeSettings;
      const before = await readHomeTimeSettings(admin, orgId);
      await saveHomeTimeSettings(admin, orgId, req.auth!.userId, next, new Date());
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "settings.home_time_alerts_saved", entity: "home_time_settings", entityId: orgId, meta: { before, after: next } });
      res.json({ settings: next });
    }),
  );

  return router;
}
