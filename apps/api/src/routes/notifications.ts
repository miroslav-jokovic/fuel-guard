import { Router } from "express";
import {
  markReadRequestSchema,
  registerPushTokenRequestSchema,
  updatePreferencesRequestSchema,
} from "@silvicom/shared";
import { requireAuth, requireOrg } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { revokePushTokens } from "../services/notify.js";

/**
 * The notification centre (Phase 5N, D53). Mounted under `/api/me/notifications`.
 *
 * A notification is addressed to ONE login: RLS scopes every read to `auth.uid()`, so even an admin
 * cannot open somebody else's inbox — the one place in this product where org-wide read would be
 * wrong. The in-app list is the fallback that matters: a driver who denied the OS permission still
 * sees everything here.
 *
 * Gated on the `notifications` module (D55) — except token REVOCATION, which must keep working even
 * for a tenant whose entitlement has lapsed, or a phone would go on receiving fleet content after
 * the module was switched off.
 */
export function notificationsRouter(): Router {
  const router = Router();
  // Applied here rather than at the mount so app.ts keeps the plain `path, xRouter()` shape the
  // auth fitness test discovers — a router that hides from that check is the failure it exists to
  // prevent. Every route below therefore has a verified JWT before requireOrg reads req.auth.
  router.use(requireAuth);

  /** Sign-out. Deliberately OUTSIDE the module gate — see the note above. */
  router.post(
    "/token/revoke",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const revoked = await revokePushTokens(admin, req.auth!.userId);
      res.json({ ok: true, revoked });
    }),
  );

  router.use(requireModule("notifications"));


  /** The bell: newest first, with the unread count and the user's own preferences. */
  router.get(
    "/",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;

      const [eventsRes, readsRes, prefsRes] = await Promise.all([
        admin
          .from("notification_events")
          .select("id, category, title, body, severity, entity_type, entity_id, deep_link, created_at")
          .eq("org_id", orgId)
          .eq("audience_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
        admin.from("notification_reads").select("event_id, read_at").eq("user_id", userId),
        admin
          .from("notification_preferences")
          .select("muted_categories, quiet_hours_start, quiet_hours_end, timezone")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      const readAt = new Map<string, string>();
      for (const r of (readsRes.data ?? []) as { event_id: string; read_at: string }[]) {
        readAt.set(r.event_id, r.read_at);
      }
      const notifications = ((eventsRes.data ?? []) as unknown as { id: string }[]).map((e) => ({
        ...e,
        read_at: readAt.get(e.id) ?? null,
      }));

      res.json({
        notifications,
        unread: notifications.filter((n) => n.read_at === null).length,
        preferences:
          prefsRes.data ?? { muted_categories: [], quiet_hours_start: null, quiet_hours_end: null, timezone: "UTC" },
      });
    }),
  );

  /** Mark specific notifications read, or omit `ids` to clear the badge entirely. */
  router.post(
    "/read",
    requireOrg,
    validateBody(markReadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof markReadRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const userId = req.auth!.userId;

      let ids = body.ids;
      if (!ids) {
        const { data } = await admin
          .from("notification_events")
          .select("id")
          .eq("org_id", req.auth!.orgId!)
          .eq("audience_user_id", userId)
          .limit(500);
        ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      }
      if (ids.length > 0) {
        await admin
          .from("notification_reads")
          .upsert(ids.map((event_id) => ({ event_id, user_id: userId })), { onConflict: "event_id,user_id" });
      }
      res.json({ ok: true, marked: ids.length });
    }),
  );

  /**
   * Register this device for push. The token is the primary key, so a reinstall updates rather than
   * accumulating dead endpoints.
   */
  router.post(
    "/token",
    requireOrg,
    validateBody(registerPushTokenRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof registerPushTokenRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      await admin.from("device_push_tokens").upsert(
        {
          token: body.token,
          org_id: req.auth!.orgId!,
          user_id: req.auth!.userId,
          platform: body.platform,
          app_version: body.app_version ?? null,
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "token" },
      );
      res.json({ ok: true });
    }),
  );


  /** Category mutes + quiet hours, enforced server-side (a device setting cannot be trusted). */
  router.patch(
    "/preferences",
    requireOrg,
    validateBody(updatePreferencesRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof updatePreferencesRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const patch: Record<string, unknown> = {
        user_id: req.auth!.userId,
        org_id: req.auth!.orgId!,
        updated_at: new Date().toISOString(),
      };
      for (const k of ["muted_categories", "quiet_hours_start", "quiet_hours_end", "timezone"] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const { error } = await admin.from("notification_preferences").upsert(patch, { onConflict: "user_id" });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not save your notification settings"));
        return;
      }
      res.json({ ok: true });
    }),
  );

  return router;
}
