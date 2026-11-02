import { Router, type Request } from "express";
import { CHAT_SEARCH_MAX, OFFICE_ROLES, chatLineLinksRequestSchema, isRecordId } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { chatSearch } from "../chatSearch.js";
import { chatLineLinks } from "../chatLinks.js";

/**
 * GET /api/chat/search?q=…[&thread=…][&before_at=…&before_id=…] (OFFICE-CHAT-PLAN CH8) — the lines the
 * caller can read that match every word of `q`, newest first; `thread` keeps it to one conversation or
 * channel. The SAME gates as the conversation router, on the route itself, for chatFiles.ts's reason:
 * this router is mounted at the chat root ahead of it (`chatMount.ts`), where the conversation router
 * would read `/search` as a conversation id. A search is not a message: no budget, no bell, no ledger.
 *
 * POST /api/chat/links { message_ids } (Q-CHATUI6 (a), 0547) shares the router: the same read of lines the
 * caller may read, answering which of their words are a load or a truck. A POST because the ids are up to
 * 200 and a URL would carry them badly (memory: ".in() overflows Node 22's headers").
 */
function gates() {
  return [requireAuth, requireOrg, requireModule("messages"), requireRole(...OFFICE_ROLES), requireSurface("chat")];
}
const str = (req: Request, name: string): string | null => (typeof req.query[name] === "string" ? (req.query[name] as string) : null);

export function chatSearchRouter(): Router {
  const router = Router();
  router.get(
    "/search",
    ...gates(),
    asyncHandler(async (req, res) => {
      const q = str(req, "q") ?? "";
      if (q.length > CHAT_SEARCH_MAX) {
        res.status(422).json(apiError("search_too_long", `A search is ${CHAT_SEARCH_MAX} characters at most`));
        return;
      }
      const threadRaw = str(req, "thread");
      if (threadRaw !== null && !isRecordId(threadRaw)) {
        res.status(404).json(apiError("not_found", "That conversation does not exist"));
        return;
      }
      const beforeAt = str(req, "before_at");
      const beforeIdRaw = str(req, "before_id");
      const beforeId = beforeIdRaw !== null && isRecordId(beforeIdRaw) ? beforeIdRaw : null;
      if ((beforeAt === null) !== (beforeId === null) || (beforeAt !== null && Number.isNaN(Date.parse(beforeAt)))) {
        res.status(400).json(apiError("bad_cursor", "before_at and before_id go together"));
        return;
      }
      const limitRaw = str(req, "limit");
      const limit = limitRaw !== null && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
      const result = await chatSearch(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, req.auth!.userId, {
        q, thread: threadRaw, before_at: beforeAt, before_id: beforeId, limit,
      });
      if (!result.ok) { res.status(result.status).json(apiError(result.code, result.message)); return; }
      res.json(result.value);
    }),
  );
  router.post(
    "/links",
    ...gates(),
    validateBody(chatLineLinksRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatLineLinksRequestSchema.parse>;
      const result = await chatLineLinks(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, req.auth!.userId, body.message_ids);
      if (!result.ok) { res.status(result.status).json(apiError(result.code, result.message)); return; }
      res.json(result.value);
    }),
  );
  return router;
}
