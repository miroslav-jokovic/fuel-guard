import { Router, type Request, type Response } from "express";
import { OFFICE_ROLES, chatFileDeclarationSchema, isRecordId } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import type { ChatResult } from "../chat.js";
import { chatFileLink, chatFilesList, chatFileUpload } from "../chatFiles.js";

/**
 * Office chat files (OFFICE-CHAT-PLAN CH7) — the three routes a file needs besides the send:
 *
 *   POST /api/chat/:id/files     → a file id and a signed upload URL (the browser PUTs the bytes there)
 *   GET  /api/chat/:id/files     → the conversation's files, newest first (its header's Files list)
 *   GET  /api/chat/files/:fileId → a five-minute link to one file
 *
 * The SAME gates as the conversation router — every office role, the `messages` module, the /chat screen —
 * attached to each route rather than to the router: this router is mounted at the chat root ahead of the
 * conversation router (`chatMount.ts`), and a `router.use` here would run the gates a second time for every
 * chat request that merely passes through. None of these is a new message, so none counts against the
 * message budget; the send that carries the files does.
 */
function gates() {
  return [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat")];
}

const ctx = (req: Request) => ({ orgId: req.auth!.orgId!, userId: req.auth!.userId });
const admin = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
const idParam = (req: Request, name: string): string | null => {
  const v = req.params[name];
  const s = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  return isRecordId(s) ? s : null;
};
const notFound = (res: Response, what: string) => res.status(404).json(apiError("not_found", `That ${what} does not exist`));
const send = <T>(res: Response, result: ChatResult<T>, ok: (v: T) => unknown, status = 200): void => {
  if (!result.ok) { res.status(result.status).json(apiError(result.code, result.message)); return; }
  res.status(status).json(ok(result.value));
};

export function chatFilesRouter(): Router {
  const router = Router();

  router.get(
    "/files/:fileId",
    ...gates(),
    asyncHandler(async (req, res) => {
      const fileId = idParam(req, "fileId");
      if (!fileId) { notFound(res, "file"); return; }
      const { orgId, userId } = ctx(req);
      send(res, await chatFileLink(admin(req), orgId, userId, fileId), (v) => v);
    }),
  );

  router.post(
    "/:id/files",
    ...gates(),
    validateBody(chatFileDeclarationSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "conversation"); return; }
      const { orgId, userId } = ctx(req);
      const body = res.locals.body as ReturnType<typeof chatFileDeclarationSchema.parse>;
      send(res, await chatFileUpload(admin(req), orgId, userId, id, body), (v) => v, 201);
    }),
  );

  router.get(
    "/:id/files",
    ...gates(),
    asyncHandler(async (req, res) => {
      const id = idParam(req, "id");
      if (!id) { notFound(res, "conversation"); return; }
      const beforeAt = typeof req.query.before_at === "string" ? req.query.before_at : null;
      const beforeId = typeof req.query.before_id === "string" && isRecordId(req.query.before_id) ? req.query.before_id : null;
      if ((beforeAt === null) !== (beforeId === null) || (beforeAt !== null && Number.isNaN(Date.parse(beforeAt)))) {
        res.status(400).json(apiError("bad_cursor", "before_at and before_id go together"));
        return;
      }
      const limit = typeof req.query.limit === "string" && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : undefined;
      const { orgId, userId } = ctx(req);
      send(res, await chatFilesList(admin(req), orgId, userId, id, { before_at: beforeAt, before_id: beforeId, limit }), (v) => v);
    }),
  );

  return router;
}
