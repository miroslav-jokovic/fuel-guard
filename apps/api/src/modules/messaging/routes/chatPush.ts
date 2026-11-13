import { Router, type Request } from "express";
import {
  OFFICE_ROLES,
  chatPushMessage,
  webPushSubscribeRequestSchema,
  webPushUnsubscribeRequestSchema,
  type WebPushStateResponse,
  type WebPushSubscribeRequest,
  type WebPushTestResponse,
  type WebPushUnsubscribeRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { chatPushKeys, recordPushOutcome } from "../chatPush.js";
import { sendPush } from "../webPush.js";

/**
 * `/api/chat/push` — this device's chat notifications (CHAT-WEB-PUSH-PLAN WP2, D-WP1, D-WP5).
 *
 *   GET    /             whether this server can push, and the public key a browser subscribes with
 *   PUT    /subscription register this browser for the caller (or refresh it: every page load does)
 *   DELETE /subscription this browser stops: turned off here, or the caller signed out of it
 *   POST   /test         a notification to every device of the caller's, to see it arrive
 *
 * GATES: the chat's own (chatSearch.ts's reason — mounted ahead of the conversation router, which would read
 * `/push` as a conversation id), EXCEPT the DELETE, which needs only a signed-in member: a person signing out
 * must be able to stop their phone even if chat was taken from them in the meantime (the reason
 * `/api/me/notifications/token/revoke` sits outside its module gate).
 *
 * The service role writes through 0599's functions, which take the org and the person from the verified
 * token, never from the body; the one table read here filters by both.
 */
function gates() {
  return [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat")];
}
const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

/** One test a person may send every 10 seconds; it notifies only themselves, so this is courtesy, not defence. */
const TEST_GAP_MS = 10_000;
const lastTest = new Map<string, number>();

/** The origins a tapped notification may open: the API's allowed browser origins and the web app's own. */
function allowedOrigin(req: Request, origin: string): boolean {
  const env = getAppLocals(req).env;
  const web = (() => {
    try { return new URL(env.WEB_APP_URL).origin; } catch { return null; }
  })();
  return env.ALLOWED_ORIGINS.includes(origin) || origin === web;
}

export function chatPushRouter(): Router {
  const router = Router();

  router.get(
    "/",
    ...gates(),
    asyncHandler(async (req, res) => {
      const keys = chatPushKeys(getAppLocals(req).env);
      const out: WebPushStateResponse = { available: keys !== null, public_key: keys?.publicKey ?? null };
      res.json(out);
    }),
  );

  router.put(
    "/subscription",
    ...gates(),
    validateBody(webPushSubscribeRequestSchema),
    asyncHandler(async (req, res) => {
      if (!chatPushKeys(getAppLocals(req).env)) {
        res.status(503).json(apiError("push_unavailable", "Notifications are not set up on this server"));
        return;
      }
      const body = res.locals.body as WebPushSubscribeRequest;
      if (!allowedOrigin(req, body.origin)) {
        res.status(422).json(apiError("origin_not_allowed", "Notifications can only open this app"));
        return;
      }
      const { data, error } = await admin(req).rpc("web_push_subscribe", {
        p_org: req.auth!.orgId!,
        p_user: req.auth!.userId,
        p_endpoint: body.endpoint,
        p_p256dh: body.keys.p256dh,
        p_auth: body.keys.auth,
        p_origin: body.origin,
        p_label: body.device_label ?? null,
      });
      if (error) {
        if ((error as { code?: string }).code === "WP001") {
          res.status(403).json(apiError("forbidden", "Only an office member can turn on chat notifications"));
          return;
        }
        throw new Error(error.message);
      }
      res.json({ id: data as string });
    }),
  );

  router.delete(
    "/subscription",
    requireAuth,
    requireOrg,
    validateBody(webPushUnsubscribeRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as WebPushUnsubscribeRequest;
      const { data, error } = await admin(req).rpc("web_push_unsubscribe", {
        p_org: req.auth!.orgId!, p_user: req.auth!.userId, p_endpoint: body.endpoint, p_reason: body.reason,
      });
      if (error) throw new Error(error.message);
      res.json({ revoked: typeof data === "number" ? data : 0 });
    }),
  );

  router.post(
    "/test",
    ...gates(),
    asyncHandler(async (req, res) => {
      const keys = chatPushKeys(getAppLocals(req).env);
      if (!keys) {
        res.status(503).json(apiError("push_unavailable", "Notifications are not set up on this server"));
        return;
      }
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;
      const now = Date.now();
      if (now - (lastTest.get(userId) ?? 0) < TEST_GAP_MS) {
        res.status(429).json(apiError("rate_limited", "Wait a few seconds before sending another test"));
        return;
      }
      lastTest.set(userId, now);
      const { data, error } = await admin(req)
        .from("web_push_subscriptions")
        .select("id, endpoint, p256dh, auth, origin")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .is("revoked_at", null);
      if (error) throw new Error(error.message);
      const devices = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; origin: string }[];
      let sent = 0;
      await Promise.all(devices.map(async (d) => {
        const message = chatPushMessage({
          origin: d.origin,
          title: "Silvicom 360",
          body: "Notifications are on. Chat messages for you will arrive here.",
          path: "/chat",
          threadId: null,
          messageId: null,
          at: new Date(now),
        });
        const outcome = await sendPush(d, JSON.stringify(message), keys, { ttl: 300, urgency: "high" });
        await recordPushOutcome(admin(req), orgId, d, outcome);
        if (outcome.kind === "sent") sent += 1;
      }));
      const out: WebPushTestResponse = { devices: devices.length, sent };
      res.json(out);
    }),
  );

  return router;
}
