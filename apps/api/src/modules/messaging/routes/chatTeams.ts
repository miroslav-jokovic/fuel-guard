import { Router, type Request, type Response } from "express";
import {
  OFFICE_ROLES,
  chatAddMembersRequestSchema,
  chatCreateChannelRequestSchema,
  chatCreateTeamRequestSchema,
  chatRenameChannelRequestSchema,
  chatSendReplyRequestSchema,
  chatTeamAddMembersRequestSchema,
  chatTeamSetRoleRequestSchema,
  chatUpdateTeamRequestSchema,
  isRecordId,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { driverWriteLimit } from "../../../middleware/driverWriteLimit.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { holdsSurface, requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import type { ChatResult } from "../chat.js";
import { chatNotifySent } from "../chatNotify.js";
import {
  chatChannelAddMembers,
  chatChannelArchive,
  chatChannelCreate,
  chatChannelJoin,
  chatChannelLeave,
  chatChannelPosts,
  chatChannelRename,
  chatReplies,
  chatSendReply,
  chatTeamAddMembers,
  chatTeamArchive,
  chatTeamCreate,
  chatTeamDirectory,
  chatTeamMembers,
  chatTeamRemove,
  chatTeams,
  chatTeamSetRole,
  chatTeamUpdate,
} from "../chatTeams.js";

/**
 * Office chat teams and channels (OFFICE-CHAT-PLAN.md CH5b) — `/api/chat/teams…` and
 * `/api/chat/channels…`. Mounted by `chatMount.ts` AHEAD of the conversation router, whose `/:id`
 * would otherwise answer `/teams` as a conversation that does not exist.
 *
 * WHO: the conversation router's gates — every office role, the `messages` module — on every path.
 * The screen gates follow D-SURF5 (an endpoint claims a screen only when that screen alone calls it):
 *   · the Teams rail, channels, posts and replies are the /chat page's: `requireSurface("chat")`;
 *   · making a team and listing every team are Settings → Chat teams': `requireSurface("chat.teams")`
 *     (D-CHAT17 — the API asks it, the "New team" button reads it);
 *   · renaming, archiving and staffing a team are BOTH screens' — a team owner does them from the
 *     rail, a holder from Settings — so they claim neither, and pass the caller's answer to
 *     `chat.teams` to the database as `p_manager` (D-CHAT21). The database decides with it.
 *
 * WRITES: a reply counts against the person's `chat_message` budget as a post does (D-CHAT8);
 * `driverWriteLimits.ts` names the reply path. Every act is a chat-ledger row written by 0511's and
 * 0518's triggers, so nothing here writes an audit row and nothing here can forget one.
 */

/**
 * The gates, built when a router is — not when this file loads, which `app.ts` makes every test do,
 * including the ones that mock `auth.js` with only what they need (the conversation router's way).
 */
function gates() {
  return {
    officeChat: [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES)],
    chatScreen: requireSurface("chat"),
    teamsScreen: requireSurface("chat.teams"),
    holdsTeams: holdsSurface("chat.teams"),
  };
}

const ctx = (req: Request) => ({ orgId: req.auth!.orgId!, userId: req.auth!.userId });
const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

/** A path id that is not a uuid is a thing that does not exist — never a database error. */
const idParam = (req: Request, name: string): string | null => {
  const v = req.params[name];
  const s = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  return isRecordId(s) ? s : null;
};
const notFound = (res: Response, what: string) => res.status(404).json(apiError("not_found", `That ${what} does not exist`));
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
const bodyOf = <T>(res: Response) => res.locals.body as T;

export function chatTeamsRouter(): Router {
  const { officeChat, chatScreen, teamsScreen, holdsTeams } = gates();
  const router = Router();
  router.use(...officeChat, driverWriteLimit());

  /** Your Teams rail, and whether you may make a team. */
  router.get(
    "/",
    chatScreen,
    asyncHandler(async (req, res) => {
      const { orgId, userId } = ctx(req);
      const [teams, canManage] = await Promise.all([chatTeams(admin(req), orgId, userId), holdsTeams(req)]);
      res.json({ teams, can_manage: canManage });
    }),
  );

  /** Every team of the organisation — Settings → Chat teams. */
  router.get(
    "/directory",
    teamsScreen,
    asyncHandler(async (req, res) => {
      const { orgId, userId } = ctx(req);
      // `true` because the gate above has just answered it; the function refuses anything else.
      send(res, await chatTeamDirectory(admin(req), orgId, userId, true), (teams) => ({ teams }));
    }),
  );

  router.post(
    "/",
    teamsScreen,
    validateBody(chatCreateTeamRequestSchema),
    asyncHandler(async (req, res) => {
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatCreateTeamRequestSchema.parse>>(res);
      send(res, await chatTeamCreate(admin(req), orgId, userId, body), (id) => ({ space_id: id }), 201);
    }),
  );

  router.patch(
    "/:spaceId",
    validateBody(chatUpdateTeamRequestSchema),
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      if (!spaceId) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatUpdateTeamRequestSchema.parse>>(res);
      send(res, await chatTeamUpdate(admin(req), orgId, userId, spaceId, body, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  /** Archive a team and every channel in it. Nothing is deleted; everything stays readable. */
  router.post(
    "/:spaceId/archive",
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      if (!spaceId) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatTeamArchive(admin(req), orgId, userId, spaceId, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  router.get(
    "/:spaceId/members",
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      if (!spaceId) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatTeamMembers(admin(req), orgId, userId, spaceId, await holdsTeams(req)), (members) => ({ members }));
    }),
  );

  router.post(
    "/:spaceId/members",
    validateBody(chatTeamAddMembersRequestSchema),
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      if (!spaceId) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatTeamAddMembersRequestSchema.parse>>(res);
      send(res, await chatTeamAddMembers(admin(req), orgId, userId, spaceId, body.user_ids, await holdsTeams(req)), (added) => ({ added }));
    }),
  );

  router.patch(
    "/:spaceId/members/:userId",
    validateBody(chatTeamSetRoleRequestSchema),
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      const target = idParam(req, "userId");
      if (!spaceId || !target) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatTeamSetRoleRequestSchema.parse>>(res);
      send(res, await chatTeamSetRole(admin(req), orgId, userId, spaceId, target, body.space_role, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  /** Take somebody out of the team (an owner or a holder), or yourself — the same as leaving. */
  router.delete(
    "/:spaceId/members/:userId",
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      const target = idParam(req, "userId");
      if (!spaceId || !target) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatTeamRemove(admin(req), orgId, userId, spaceId, target, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  router.post(
    "/:spaceId/leave",
    chatScreen,
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      if (!spaceId) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      // Leaving is a member's own act: no permission makes it more or less possible.
      send(res, await chatTeamRemove(admin(req), orgId, userId, spaceId, null, false), () => ({ ok: true }));
    }),
  );

  /** A channel in a team you are in. */
  router.post(
    "/:spaceId/channels",
    chatScreen,
    validateBody(chatCreateChannelRequestSchema),
    asyncHandler(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      if (!spaceId) { notFound(res, "team"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatCreateChannelRequestSchema.parse>>(res);
      send(res, await chatChannelCreate(admin(req), orgId, userId, spaceId, body), (id) => ({ thread_id: id }), 201);
    }),
  );

  return router;
}

/**
 * `/api/chat/channels/:id…` — what is particular to a channel. Everything a channel shares with any
 * conversation (send a top-level post, edit, retract, mark read, sync) stays on the conversation
 * routes, because a channel IS a conversation (D-CHAT18).
 */
export function chatChannelsRouter(): Router {
  const { officeChat, chatScreen, holdsTeams } = gates();
  const router = Router();
  router.use(...officeChat, chatScreen, driverWriteLimit());

  router.post(
    "/:id/join",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatChannelJoin(admin(req), orgId, userId, id), () => ({ ok: true }));
    }),
  );

  router.post(
    "/:id/members",
    validateBody(chatAddMembersRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatAddMembersRequestSchema.parse>>(res);
      send(res, await chatChannelAddMembers(admin(req), orgId, userId, id, body.user_ids), (added) => ({ added }));
    }),
  );

  router.delete(
    "/:id/members/:userId",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      const target = idParam(req, "userId");
      if (!id || !target) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatChannelLeave(admin(req), orgId, userId, id, target, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  router.post(
    "/:id/leave",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatChannelLeave(admin(req), orgId, userId, id, null, false), () => ({ ok: true }));
    }),
  );

  router.patch(
    "/:id",
    validateBody(chatRenameChannelRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatRenameChannelRequestSchema.parse>>(res);
      send(res, await chatChannelRename(admin(req), orgId, userId, id, body.name, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  router.post(
    "/:id/archive",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatChannelArchive(admin(req), orgId, userId, id, await holdsTeams(req)), () => ({ ok: true }));
    }),
  );

  /** The channel's top-level posts, each with its reply counters; `before_seq` pages back. */
  router.get(
    "/:id/posts",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "channel"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatChannelPosts(admin(req), orgId, userId, id, intQuery(req.query.before_seq), intQuery(req.query.limit) ?? undefined), (v) => v);
    }),
  );

  router.get(
    "/:id/posts/:postId/replies",
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      const postId = idParam(req, "postId");
      if (!id || !postId) { notFound(res, "post"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatReplies(admin(req), orgId, userId, id, postId, intQuery(req.query.before_seq), intQuery(req.query.limit) ?? undefined), (v) => v);
    }),
  );

  router.post(
    "/:id/posts/:postId/replies",
    validateBody(chatSendReplyRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      const postId = idParam(req, "postId");
      if (!id || !postId) { notFound(res, "post"); return; }
      const { orgId, userId } = ctx(req);
      const body = bodyOf<ReturnType<typeof chatSendReplyRequestSchema.parse>>(res);
      const result = await chatSendReply(admin(req), orgId, userId, id, postId, body.message_id, body.body);
      // The post's author and its earlier repliers hear of it, as D-CHAT23 says and 0521 decides (chatNotify.ts).
      if (result.ok && !result.value.duplicate) await chatNotifySent(admin(req), orgId, userId, id, body.message_id, body.body);
      // 201 for a new reply, 200 for a retry the database recognised — the client treats both as sent.
      send(res, result, (v) => v, result.ok && !result.value.duplicate ? 201 : 200);
    }),
  );

  return router;
}
