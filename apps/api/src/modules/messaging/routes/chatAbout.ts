import { Router, type Request, type Response } from "express";
import {
  CHAT_ABOUT_KINDS,
  CHAT_ABOUT_READ_SECTION,
  OFFICE_ROLES,
  callerCanView,
  chatCreateAboutRequestSchema,
  isRecordId,
  type ChatAboutKind,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import type { ChatResult } from "../chat.js";
import { chatAboutList, chatCreateAbout, chatThreadAbout } from "../chatAbout.js";

/**
 * "Chat about this" (OFFICE-CHAT-PLAN CH11b, §9.4):
 *
 *   POST /api/chat/about                    → a group about one load, driver or truck ({ thread_id })
 *   GET  /api/chat/about/:kind/:recordId    → the conversations about it the caller is in
 *   GET  /api/chat/:id/about                → what one conversation is about, or null (its header)
 *
 * The chat's own gates on every route, as chatFiles.ts does, because this router is mounted at the chat
 * root ahead of the conversation router (`chatMount.ts`). The first two also ask whether the caller may
 * read that KIND of record (D-CHAT33, `CHAT_ABOUT_READ_SECTION`): a dispatcher without roster view cannot
 * start, or learn of, a conversation about a driver they cannot open. The header's answer needs no such
 * check — a member already reads the conversation, and the label is what the conversation was made about.
 */
function gates() {
  return [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat")];
}
const ctx = (req: Request) => ({ orgId: req.auth!.orgId!, userId: req.auth!.userId });
const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
const send = <T>(res: Response, result: ChatResult<T>, ok: (v: T) => unknown, status = 200): void => {
  if (!result.ok) { res.status(result.status).json(apiError(result.code, result.message)); return; }
  res.status(status).json(ok(result.value));
};

/** May the caller read records of this kind? A refusal is a 403 naming the section, before any read. */
function mayRead(kind: ChatAboutKind, req: Request, res: Response): boolean {
  const section = CHAT_ABOUT_READ_SECTION[kind];
  if (section === null || callerCanView(req.auth?.role ?? null, section, req.auth?.sections ?? null)) return true;
  res.status(403).json(apiError("forbidden", `You cannot open that ${kind === "vehicle" ? "truck" : kind}`));
  return false;
}
const isKind = (v: unknown): v is ChatAboutKind => typeof v === "string" && (CHAT_ABOUT_KINDS as readonly string[]).includes(v);

export function chatAboutRouter(): Router {
  const router = Router();

  router.post(
    "/about",
    ...gates(),
    validateBody(chatCreateAboutRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatCreateAboutRequestSchema.parse>;
      if (!mayRead(body.kind, req, res)) return;
      const { orgId, userId } = ctx(req);
      send(res, await chatCreateAbout(admin(req), orgId, userId, body), (id) => ({ thread_id: id }), 201);
    }),
  );

  router.get(
    "/about/:kind/:recordId",
    ...gates(),
    asyncHandler(async (req, res) => {
      const kind = req.params.kind;
      const recordId = String(req.params.recordId ?? "");
      if (!isKind(kind) || !isRecordId(recordId)) { res.status(404).json(apiError("not_found", "No such record")); return; }
      if (!mayRead(kind, req, res)) return;
      const { orgId, userId } = ctx(req);
      send(res, await chatAboutList(admin(req), orgId, userId, kind, recordId), (v) => v);
    }),
  );

  router.get(
    "/:id/about",
    ...gates(),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!isRecordId(id)) { res.status(404).json(apiError("not_found", "That conversation does not exist")); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatThreadAbout(admin(req), orgId, userId, id), (v) => v);
    }),
  );

  return router;
}
