import { Router, type Request, type Response } from "express";
import {
  chatComplianceConversationsRequestSchema,
  chatComplianceMessagesRequestSchema,
  chatComplianceThreadRequestSchema,
  isRecordId,
  type ChatComplianceReason,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { writeAudit } from "../../../lib/audit.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import {
  chatComplianceAccessLog,
  chatComplianceConversations,
  chatComplianceMessages,
  chatCompliancePeople,
  chatComplianceThread,
  type ChatComplianceResult,
} from "../chatCompliance.js";

/**
 * The office chat compliance console (OFFICE-CHAT-PLAN CHA2, §5.2) — `/api/chat/compliance`.
 *
 * THE ONLY WAY TO READ ANOTHER PERSON'S CONVERSATION. Three gates, in order:
 *   · `requireSurface("chat.compliance")` — a Permissions-page grant (Q-CHAT2): admins hold it by
 *     default and an admin can give or take it per role or person; the grant itself is a step-up,
 *     audited act (SP8/SP9). Beside it `requireSection("settings", "view")`, the surface's own gate,
 *     because a surface narrows and never grants (D-SURF5).
 *   · `requireFreshAuth()` on every route that returns content: a stolen signed-in session cannot
 *     read the office's conversations without the password.
 *   · A REASON in the body — category and a sentence — which the 0516 function writes into the chat
 *     ledger in the same transaction as the read, so there is no search without its row.
 *
 * TWO RECORDS (§5.1). The ledger row (database) carries the act in full; `audit_logs` (here) carries
 * that an administrative act happened, so the org's ordinary Audit log shows that someone looked. The
 * audit row is written after the function answered and BEFORE the content is sent: if it cannot be
 * written the content is withheld (an access nobody can account for is the one thing this console
 * must not produce), and the ledger row — already committed — still says a search was asked for.
 *
 * NOT here: export, holds, retention (CHA3). The people list and the Access log need no step-up:
 * neither returns a message, and the log is how one holder watches another (Q-CHAT11).
 */
export function chatComplianceRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("messages"), requireSection("settings", "view"), requireSurface("chat.compliance"));

  const ctx = (req: { auth?: { orgId?: string | null; userId: string } }) => ({ orgId: req.auth!.orgId!, userId: req.auth!.userId });
  const admin = (req: Parameters<typeof getAppLocals>[0]) => getSupabaseAdmin(getAppLocals(req).env);
  const notFound = (res: Response) => res.status(404).json(apiError("not_found", "That conversation does not exist"));
  const intQuery = (v: unknown): number | null => {
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
    return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
  };

  /**
   * Record the act in `audit_logs`, then send. A failed audit write withholds the content: the ledger
   * already has the search, so nothing is lost but the answer, and the person is told to try again.
   */
  async function recordAndSend<T>(
    req: Request, res: Response, result: ChatComplianceResult<T>,
    act: { action: string; reason: ChatComplianceReason; threadId?: string | null; filters: Record<string, unknown> },
  ): Promise<void> {
    if (!result.ok) {
      res.status(result.status).json(apiError(result.code, result.message));
      return;
    }
    const { orgId, userId } = ctx(req);
    const recorded = await writeAudit(admin(req), {
      orgId, actorId: userId, action: act.action, entity: "message_threads",
      entityId: act.threadId ?? undefined,
      meta: { category: act.reason.category, reason: act.reason.text, ...act.filters },
    });
    if (!recorded) {
      res.status(503).json(apiError("audit_unavailable", "The access could not be recorded, so nothing was shown. Try again in a moment."));
      return;
    }
    res.json(result.value);
  }

  /** Who the console can filter by. Names and roles only; no step-up, no message. */
  router.get(
    "/people",
    asyncHandler(async (req, res) => {
      res.json({ people: await chatCompliancePeople(admin(req), ctx(req).orgId) });
    }),
  );

  /** Who looked, when, at what and why. Every holder may read it. */
  router.get(
    "/access-log",
    asyncHandler(async (req, res) => {
      res.json(await chatComplianceAccessLog(admin(req), ctx(req).orgId, intQuery(req.query.before_seq), intQuery(req.query.limit) ?? undefined));
    }),
  );

  router.post(
    "/conversations",
    requireFreshAuth(),
    validateBody(chatComplianceConversationsRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatComplianceConversationsRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const result = await chatComplianceConversations(admin(req), orgId, userId, body);
      await recordAndSend(req, res, result, {
        action: "chat_compliance.search", reason: body.reason,
        filters: { scope: "conversations", person: body.person ?? null, from: body.from ?? null, to: body.to ?? null },
      });
    }),
  );

  router.post(
    "/messages",
    requireFreshAuth(),
    validateBody(chatComplianceMessagesRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatComplianceMessagesRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const result = await chatComplianceMessages(admin(req), orgId, userId, body);
      await recordAndSend(req, res, result, {
        action: "chat_compliance.search", reason: body.reason, threadId: body.thread ?? null,
        filters: { scope: "messages", thread: body.thread ?? null, person: body.person ?? null, from: body.from ?? null, to: body.to ?? null, q: body.q?.trim() || null },
      });
    }),
  );

  router.post(
    "/conversations/:id",
    requireFreshAuth(),
    validateBody(chatComplianceThreadRequestSchema),
    asyncHandler(async (req, res) => {
      const raw = req.params.id;
      const id = typeof raw === "string" && isRecordId(raw) ? raw : null;
      if (!id) { notFound(res); return; }
      const body = res.locals.body as ReturnType<typeof chatComplianceThreadRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const result = await chatComplianceThread(admin(req), orgId, userId, id, body);
      await recordAndSend(req, res, result, {
        action: "chat_compliance.view", reason: body.reason, threadId: id,
        filters: { before_seq: body.before_seq ?? null },
      });
    }),
  );

  return router;
}
