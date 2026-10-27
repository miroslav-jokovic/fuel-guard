import { Router, type Response } from "express";
import {
  CHAT_KINDS,
  OFFICE_ROLES,
  chatActivityReadRequestSchema,
  chatAddMembersRequestSchema,
  chatCreateGroupRequestSchema,
  chatEditRequestSchema,
  chatMuteRequestSchema,
  chatOpenDirectRequestSchema,
  chatReadRequestSchema,
  chatRenameRequestSchema,
  chatSendRequestSchema,
  isRecordId,
  type ChatKind,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { driverWriteLimit } from "../../../middleware/driverWriteLimit.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import {
  chatAddMembers,
  chatCreateGroup,
  chatDirectory,
  chatEdit,
  chatHistory,
  chatInbox,
  chatLeave,
  chatMarkRead,
  chatMembers,
  chatOpen,
  chatOpenDirect,
  chatRename,
  chatRetract,
  chatSend,
  chatSync,
  type ChatResult,
} from "../chat.js";
import { chatActivity, chatActivityMarkRead, chatActivityUnread, chatSetMute } from "../chatActivity.js";
import { chatLineBeforeEdit, chatNotifyEdited, chatNotifySent } from "../chatNotify.js";

/**
 * Office chat (OFFICE-CHAT-PLAN.md CH1b) — `/api/chat`. The conversations between the people in the
 * office; the driver threads stay on `/api/messages` (D54), which this router never writes.
 *
 * WHO: every office role, derived (`OFFICE_ROLES` = every role but the roster-issued driver), and the
 * same `messages` module as the driver threads, because it is the same engine (D-CHAT1). No section
 * gate: chat is not a section's data, and gating it on one is how recruiting ended up on the driver
 * page (CLAUDE.md, No workarounds). Which conversation a person may read is not a role question at
 * all — it is participation, answered by 0512 on every call. `requireSurface("chat")` is the screen's
 * own answer (D-SURF5): every route here serves the /chat page and nothing else, so it may carry it.
 *
 * WRITES: a new message counts against the person's `chat_message` budget (D-CHAT8, 3,000 a day).
 * Every write is recorded in the chat ledger by 0511's triggers — nothing here writes an audit row,
 * so nothing here can forget one. A new line, and an edit that names somebody new, then rings the bell
 * of whoever 0521's `chat_notify_targets` says (D-CHAT23, chatNotify.ts) before the answer goes back.
 */
export function chatRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat"));
  router.use(driverWriteLimit());

  const ctx = (req: { auth?: { orgId?: string | null; userId: string } }) => ({
    orgId: req.auth!.orgId!,
    userId: req.auth!.userId,
  });
  const admin = (req: Parameters<typeof getAppLocals>[0]) => getSupabaseAdmin(getAppLocals(req).env);

  /** A path id that is not a uuid is a conversation that does not exist — never a database error. */
  const idParam = (req: { params: Record<string, unknown> }, name: string): string | null => {
    const v = req.params[name];
    const s = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
    return isRecordId(s) ? s : null;
  };
  const notFound = (res: Response) => res.status(404).json(apiError("not_found", "That conversation does not exist"));
  const send = <T>(res: Response, result: ChatResult<T>, ok: (v: T) => unknown, status = 200): void => {
    if (!result.ok) {
      res.status(result.status).json(apiError(result.code, result.message));
      return;
    }
    res.status(status).json(ok(result.value));
  };
  const intQuery = (v: unknown): number | null => {
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
    return n !== null && Number.isSafeInteger(n) ? n : null;
  };

  /** The inbox. `before_at` + `before_id` page it, newest first. */
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const beforeAt = typeof req.query.before_at === "string" ? req.query.before_at : null;
      const beforeId = typeof req.query.before_id === "string" && isRecordId(req.query.before_id) ? req.query.before_id : null;
      if ((beforeAt === null) !== (beforeId === null) || (beforeAt !== null && Number.isNaN(Date.parse(beforeAt)))) {
        res.status(400).json(apiError("bad_cursor", "before_at and before_id go together"));
        return;
      }
      // `kinds=direct,group`: which kinds of conversation; absent = all of them. An unknown kind is a 400,
      // not silently dropped, so a typo cannot read as "you have no conversations".
      const kinds = typeof req.query.kinds === "string" ? req.query.kinds.split(",").filter(Boolean) : [];
      if (!kinds.every((k): k is ChatKind => (CHAT_KINDS as readonly string[]).includes(k))) {
        res.status(400).json(apiError("bad_kinds", `kinds is a comma-separated list of ${CHAT_KINDS.join(", ")}`));
        return;
      }
      const { orgId, userId } = ctx(req);
      res.json(await chatInbox(admin(req), orgId, userId, {
        before_at: beforeAt, before_id: beforeId, limit: intQuery(req.query.limit) ?? undefined, kinds,
      }));
    }),
  );

  /** Who a conversation may name — the people picker. */
  router.get(
    "/people",
    asyncHandler(async (req, res) => {
      res.json({ people: await chatDirectory(admin(req), ctx(req).orgId) });
    }),
  );

  /**
   * Activity (D-CHAT25): what named you and what answered your posts, newest first, with its badge.
   * Ahead of `/:id`, which would answer `/activity` as a conversation that does not exist.
   */
  router.get(
    "/activity",
    asyncHandler(async (req, res) => {
      const beforeAt = typeof req.query.before_at === "string" ? req.query.before_at : null;
      const beforeId = typeof req.query.before_id === "string" && isRecordId(req.query.before_id) ? req.query.before_id : null;
      if ((beforeAt === null) !== (beforeId === null) || (beforeAt !== null && Number.isNaN(Date.parse(beforeAt)))) {
        res.status(400).json(apiError("bad_cursor", "before_at and before_id go together"));
        return;
      }
      const { orgId, userId } = ctx(req);
      res.json(await chatActivity(admin(req), orgId, userId, {
        before_at: beforeAt, before_id: beforeId, limit: intQuery(req.query.limit) ?? undefined,
      }));
    }),
  );

  router.get(
    "/activity/unread",
    asyncHandler(async (req, res) => {
      const { orgId, userId } = ctx(req);
      res.json({ unread: await chatActivityUnread(admin(req), orgId, userId) });
    }),
  );

  router.post(
    "/activity/read",
    validateBody(chatActivityReadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatActivityReadRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      res.json({ activity_read_at: await chatActivityMarkRead(admin(req), orgId, userId, body.at) });
    }),
  );

  /** Open (or find) the one conversation with a person. 200 either way: the caller just wants it. */
  router.post(
    "/direct",
    validateBody(chatOpenDirectRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatOpenDirectRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      send(res, await chatOpenDirect(admin(req), orgId, userId, body.user_id, body.thread_id), (id) => ({ thread_id: id }));
    }),
  );

  router.post(
    "/groups",
    validateBody(chatCreateGroupRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatCreateGroupRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      send(res, await chatCreateGroup(admin(req), orgId, userId, body), (id) => ({ thread_id: id }), 201);
    }),
  );

  /** Edit your own message. The words it replaces are kept (0511, D-CHAT13). */
  router.patch(
    "/messages/:messageId",
    validateBody(chatEditRequestSchema),
    asyncHandler(async (req, res) => {
      const messageId = idParam(req, "messageId");
      if (!messageId) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatEditRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const before = await chatLineBeforeEdit(admin(req), orgId, messageId, body.body);
      const result = await chatEdit(admin(req), orgId, userId, messageId, body.body);
      if (result.ok) await chatNotifyEdited(admin(req), orgId, userId, messageId, body.body, before);
      send(res, result, (rev) => ({ rev }));
    }),
  );

  /** Retract your own message. It stops rendering; the row and its words stay (D-CHAT13). */
  router.delete(
    "/messages/:messageId",
    asyncHandler(async (req, res) => {
      const messageId = idParam(req, "messageId");
      if (!messageId) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatRetract(admin(req), orgId, userId, messageId), (rev) => ({ rev }));
    }),
  );

  /** One conversation: header, members, newest page. */
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatOpen(admin(req), orgId, userId, id), (v) => v);
    }),
  );

  /** An older page: `before_seq` from the previous answer. */
  router.get(
    "/:id/messages",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatHistory(admin(req), orgId, userId, id, intQuery(req.query.before_seq), intQuery(req.query.limit) ?? undefined), (v) => v);
    }),
  );

  /** Who is in it — a channel's people for the composer's `@` list (CH6b-2). */
  router.get(
    "/:id/members",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatMembers(admin(req), orgId, userId, id), (members) => ({ members }));
    }),
  );

  /** What changed after `since_rev`: new messages, edits, retractions. */
  router.get(
    "/:id/sync",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatSync(admin(req), orgId, userId, id, intQuery(req.query.since_rev) ?? 0), (v) => v);
    }),
  );

  router.post(
    "/:id/messages",
    validateBody(chatSendRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatSendRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const result = await chatSend(admin(req), orgId, userId, id, body.message_id, body.body);
      if (result.ok && !result.value.duplicate) await chatNotifySent(admin(req), orgId, userId, id, body.message_id, body.body);
      // 201 for a new message, 200 for a retry the database recognised — the client treats both as sent.
      send(res, result, (v) => v, result.ok && !result.value.duplicate ? 201 : 200);
    }),
  );

  router.post(
    "/:id/read",
    validateBody(chatReadRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatReadRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      send(res, await chatMarkRead(admin(req), orgId, userId, id, body.seq), (seq) => ({ read_seq: seq }));
    }),
  );

  /** Quieten it for yourself: `none`, `mentions` or `all` (D-CHAT23). Nobody else sees it (D-CHAT24). */
  router.put(
    "/:id/mute",
    validateBody(chatMuteRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatMuteRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      send(res, await chatSetMute(admin(req), orgId, userId, id, body.muted), (muted) => ({ muted }));
    }),
  );

  /** Rename a group. */
  router.patch(
    "/:id",
    validateBody(chatRenameRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatRenameRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      send(res, await chatRename(admin(req), orgId, userId, id, body.subject), () => ({ ok: true }));
    }),
  );

  router.post(
    "/:id/members",
    validateBody(chatAddMembersRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatAddMembersRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      send(res, await chatAddMembers(admin(req), orgId, userId, id, body.user_ids), (added) => ({ added }));
    }),
  );

  /** Remove somebody (an owner), or yourself — the same as leaving. */
  router.delete(
    "/:id/members/:userId",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      const target = idParam(req, "userId");
      if (!id || !target) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatLeave(admin(req), orgId, userId, id, target), () => ({ ok: true }));
    }),
  );

  router.post(
    "/:id/leave",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatLeave(admin(req), orgId, userId, id, null), () => ({ ok: true }));
    }),
  );

  return router;
}
