import { Router, type Request } from "express";
import { OFFICE_ROLES, chatPushPrivacySchema, type ChatPushPrivacy } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";

/**
 * `/api/chat/push/privacy` — whether the caller's chat notifications leave out the message text
 * (INSTALLED-APP-PLAN IA-S4; Q-IA4 (a), the owner's ruling of 2026-11-15: each person's own switch; 0614).
 *
 *   GET  /   { hide_text }
 *   PUT  /   { hide_text }  set it, answering what is now stored
 *
 * Its own router, mounted ahead of `/push` (chatMount.ts) under the chat's gates, as Do not disturb is. Both
 * go through 0614's functions, which take the person and the org from the verified token, never the body. The
 * read asks the function the delivery asks (`chat_push_text_hidden_for`) with a list of one, so what the
 * control shows is what the next push will do.
 */
function gates() {
  return [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat")];
}
const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

export function chatPushPrivacyRouter(): Router {
  const router = Router();

  router.get(
    "/",
    ...gates(),
    asyncHandler(async (req, res) => {
      const { data, error } = await admin(req).rpc("chat_push_text_hidden_for", { p_org: req.auth!.orgId!, p_users: [req.auth!.userId] });
      if (error) throw new Error(error.message);
      const answer: ChatPushPrivacy = { hide_text: ((data ?? []) as unknown[]).length > 0 };
      res.json(answer);
    }),
  );

  router.put(
    "/",
    ...gates(),
    validateBody(chatPushPrivacySchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ChatPushPrivacy;
      const { data, error } = await admin(req).rpc("chat_push_hide_text", { p_org: req.auth!.orgId!, p_user: req.auth!.userId, p_hide: body.hide_text });
      if (error) {
        if (error.code === "WP001") {
          res.status(403).json(apiError("forbidden", "Only an office member can change this"));
          return;
        }
        throw new Error(error.message);
      }
      // What the database says it stored, not what was asked for.
      const answer: ChatPushPrivacy = { hide_text: data === true };
      res.json(answer);
    }),
  );

  return router;
}
