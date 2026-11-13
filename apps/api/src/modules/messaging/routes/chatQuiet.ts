import { Router, type Request, type Response } from "express";
import {
  CHAT_DND_NONE,
  OFFICE_ROLES,
  chatDndPauseRequestSchema,
  chatDndScheduleRequestSchema,
  type ChatDndPauseRequest,
  type ChatDndScheduleRequest,
  type ChatDndState,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";

/**
 * `/api/chat/push/quiet` — the caller's Do not disturb (CHAT-WEB-PUSH-PLAN WP5; D-WP13, D-WP14; 0603).
 *
 *   GET  /          the pause, the nightly window, and whether chat notifications are held back right now
 *   PUT  /pause     { until }  pause until an instant, or resume (null)
 *   PUT  /schedule  { start, end, timezone }  the nightly window, or none
 *
 * Its own router, mounted ahead of `/push` (chatMount.ts), under the chat's gates: Do not disturb is chat's, so a
 * carrier with Messages and without the Notifications module has it (Q-WP4 — the bell's module question is not
 * this one). Every read and write goes through 0603's functions, which take the person and the org from the
 * verified token, never the body, and refuse anybody who is not an active office member (WP001).
 */
function gates() {
  return [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat")];
}
const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

interface StateRow {
  paused_until: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  quiet_now: boolean;
}

/** Postgres `time` reads "22:00:00"; the control and the contract speak "22:00". */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

async function readState(req: Request): Promise<ChatDndState> {
  const { data, error } = await admin(req).rpc("chat_dnd_state", { p_org: req.auth!.orgId!, p_user: req.auth!.userId });
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as StateRow[])[0];
  if (!row) return CHAT_DND_NONE;
  return {
    paused_until: row.paused_until,
    quiet_start: hhmm(row.quiet_hours_start),
    quiet_end: hhmm(row.quiet_hours_end),
    timezone: row.timezone,
    quiet_now: row.quiet_now === true,
  };
}

/** 0603's refusals in the API's words: not a member (403), a value it will not hold (422). */
function refused(res: Response, error: { code?: string; message: string }): boolean {
  if (error.code === "WP001") {
    res.status(403).json(apiError("forbidden", "Only an office member can set Do not disturb"));
    return true;
  }
  if (error.code === "22023") {
    res.status(422).json(apiError("invalid_request", error.message));
    return true;
  }
  return false;
}

export function chatQuietRouter(): Router {
  const router = Router();

  router.get(
    "/",
    ...gates(),
    asyncHandler(async (req, res) => {
      res.json(await readState(req));
    }),
  );

  router.put(
    "/pause",
    ...gates(),
    validateBody(chatDndPauseRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ChatDndPauseRequest;
      const { error } = await admin(req).rpc("chat_dnd_pause", { p_org: req.auth!.orgId!, p_user: req.auth!.userId, p_until: body.until });
      if (error) {
        if (refused(res, error)) return;
        throw new Error(error.message);
      }
      res.json(await readState(req));
    }),
  );

  router.put(
    "/schedule",
    ...gates(),
    validateBody(chatDndScheduleRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ChatDndScheduleRequest;
      const { error } = await admin(req).rpc("chat_dnd_schedule", {
        p_org: req.auth!.orgId!, p_user: req.auth!.userId, p_start: body.start, p_end: body.end, p_tz: body.timezone,
      });
      if (error) {
        if (refused(res, error)) return;
        throw new Error(error.message);
      }
      res.json(await readState(req));
    }),
  );

  return router;
}
