import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  chatExportRequestSchema,
  chatHoldReleaseRequestSchema,
  chatHoldSetRequestSchema,
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
  chatExportCreate,
  chatExportLinks,
  chatExports,
  chatHoldRelease,
  chatHoldSet,
  chatHolds,
  type ChatRecordsResult,
} from "../chatComplianceRecords.js";

/**
 * Legal holds and exports in the compliance console (OFFICE-CHAT-PLAN CHA3b; D-CHAT15, D-CHAT20) —
 * `/api/chat/compliance/holds` and `/api/chat/compliance/exports`.
 *
 * The console's gates, unchanged (`chatCompliance.ts` explains each): the settings section, the
 * `chat.compliance` grant, and `requireFreshAuth()` on every act. Setting or releasing a hold and
 * making an export each need a REASON in the body, which 0517 writes into the chat ledger in the
 * same transaction as the act; `audit_logs` gets its row beside it, so the org's Audit log shows
 * that the act happened.
 *
 * ONE DIFFERENCE FROM THE READS: a read's audit row is written before the content is sent, and a
 * failed write withholds the content. A hold or an export has already HAPPENED when the database
 * answers — the hold is in force, the files are in the bucket — so withholding the answer would only
 * hide a fact the ledger already holds. A failed audit write is logged loudly and the act reported.
 *
 * Reading the holds and the exports list needs no step-up: neither returns a message, and both are
 * how one holder sees what another did (Q-CHAT11). Download links need step-up, because the files
 * are the words.
 */
export function chatComplianceRecordsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("messages"), requireSection("settings", "view"), requireSurface("chat.compliance"));

  const ctx = (req: { auth?: { orgId?: string | null; userId: string } }) => ({ orgId: req.auth!.orgId!, userId: req.auth!.userId });
  const admin = (req: Parameters<typeof getAppLocals>[0]) => getSupabaseAdmin(getAppLocals(req).env);
  const idParam = (req: Request): string | null => {
    const raw = req.params.id;
    return typeof raw === "string" && isRecordId(raw) ? raw : null;
  };

  async function recordAndSend<T>(
    req: Request, res: Response, result: ChatRecordsResult<T>,
    act: { action: string; reason: ChatComplianceReason; entity: string; entityId?: string | null; meta: Record<string, unknown> },
    status = 200,
  ): Promise<void> {
    if (!result.ok) {
      res.status(result.status).json(apiError(result.code, result.message));
      return;
    }
    const { orgId, userId } = ctx(req);
    const recorded = await writeAudit(admin(req), {
      orgId, actorId: userId, action: act.action, entity: act.entity, entityId: act.entityId ?? undefined,
      meta: { category: act.reason.category, reason: act.reason.text, ...act.meta },
    });
    if (!recorded) console.error(`[chat-compliance] ${act.action} done and ledgered, but its audit_logs row could not be written`);
    res.status(status).json(result.value);
  }

  // ── holds ───────────────────────────────────────────────────────────────────────────────────────

  router.get(
    "/holds",
    asyncHandler(async (req, res) => {
      res.json(await chatHolds(admin(req), ctx(req).orgId, req.query.released === "1"));
    }),
  );

  router.post(
    "/holds",
    requireFreshAuth(),
    validateBody(chatHoldSetRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatHoldSetRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const result = await chatHoldSet(admin(req), orgId, userId, body);
      await recordAndSend(req, res, result, {
        action: "chat_compliance.hold_set", reason: body.reason, entity: "chat_holds",
        entityId: result.ok ? result.value.id : null,
        meta: { scope: body.scope, target: body.target, matter: body.matter },
      }, 201);
    }),
  );

  router.post(
    "/holds/:id/release",
    requireFreshAuth(),
    validateBody(chatHoldReleaseRequestSchema),
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      if (!id) { res.status(404).json(apiError("not_found", "That hold does not exist")); return; }
      const body = res.locals.body as ReturnType<typeof chatHoldReleaseRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const result = await chatHoldRelease(admin(req), orgId, userId, id, body);
      await recordAndSend(req, res, result, {
        action: "chat_compliance.hold_released", reason: body.reason, entity: "chat_holds", entityId: id, meta: {},
      });
    }),
  );

  // ── exports ─────────────────────────────────────────────────────────────────────────────────────

  router.get(
    "/exports",
    asyncHandler(async (req, res) => {
      const before = typeof req.query.before_at === "string" && !Number.isNaN(Date.parse(req.query.before_at)) ? req.query.before_at : null;
      res.json(await chatExports(admin(req), ctx(req).orgId, before));
    }),
  );

  router.post(
    "/exports",
    requireFreshAuth(),
    validateBody(chatExportRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof chatExportRequestSchema.parse>;
      const { orgId, userId } = ctx(req);
      const exportId = randomUUID();
      const result = await chatExportCreate(admin(req), orgId, userId, exportId, body);
      await recordAndSend(req, res, result, {
        action: "chat_compliance.export", reason: body.reason, entity: "chat_exports", entityId: exportId,
        meta: { scope: body.scope, thread: body.thread ?? null, person: body.person ?? null, from: body.from ?? null, to: body.to ?? null, q: body.q?.trim() || null,
          message_count: result.ok ? result.value.message_count : null },
      }, 201);
    }),
  );

  router.post(
    "/exports/:id/links",
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      if (!id) { res.status(404).json(apiError("not_found", "That export does not exist")); return; }
      const result = await chatExportLinks(admin(req), ctx(req).orgId, id);
      if (!result.ok) { res.status(result.status).json(apiError(result.code, result.message)); return; }
      res.json(result.value);
    }),
  );

  return router;
}
