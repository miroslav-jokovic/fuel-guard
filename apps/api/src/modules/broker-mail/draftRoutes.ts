import type { Request, Response, Router } from "express";
import {
  BROKER_MAIL_ALL_PERMISSION,
  brokerMailCloseSchema,
  brokerMailQueueDraftSchema,
  recordId,
  type BrokerMailClose,
  type BrokerMailQueueDraft,
} from "@silvicom/shared";
import { requireSection } from "../../middleware/auth.js";
import { requireSurface } from "../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { anthropicClient } from "../../lib/anthropic.js";
import { holdsNamedPermission } from "../org/index.js";
import { closeBrokerMail, composeBrokerMailDraft, queueBrokerMailDraft, readBrokerMailDetail, type DraftResult } from "./brokerMailDraft.js";

/**
 * `/api/broker-mail/messages/:id…` (BROKER-MAIL-READER-PLAN P4, 0656), mounted by `brokerMailRouter`
 * behind its auth, org and module gates. Reading the panel follows the list's rule (own, or all with
 * `dispatch.broker_mail_all`); compose, queue and close are the mailbox OWNER's alone, decided in
 * `brokerMailDraft.ts`. Queueing and closing are audited; a composition is on the cost ledger.
 */
export function mountDraftRoutes(router: Router): void {
  const pageGate = [requireSection("dispatch", "view"), requireSurface("dispatch.broker-mail")];
  const answer = <T,>(res: Response, r: DraftResult<T>) => {
    if (r.ok) res.json(r.value);
    else res.status(r.status).json(apiError(r.code, r.message));
  };
  const messageId = (req: Request, res: Response): string | null => {
    const p = recordId().safeParse(req.params.id);
    if (!p.success) { res.status(404).json(apiError("not_found", "That broker email is not in your list.")); return null; }
    return p.data;
  };

  router.get(
    "/messages/:id",
    ...pageGate,
    asyncHandler(async (req, res) => {
      const id = messageId(req, res);
      if (!id) return;
      const seesAll = await holdsNamedPermission(req, BROKER_MAIL_ALL_PERMISSION);
      answer(res, await readBrokerMailDetail(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, req.auth!.userId, seesAll, id));
    }),
  );

  router.post(
    "/messages/:id/compose",
    ...pageGate,
    asyncHandler(async (req, res) => {
      const id = messageId(req, res);
      if (!id) return;
      const env = getAppLocals(req).env;
      const ai = { client: env.ANTHROPIC_API_KEY ? anthropicClient(env) : null, model: env.BROKER_MAIL_DRAFT_MODEL };
      answer(res, await composeBrokerMailDraft(getSupabaseAdmin(getAppLocals(req).env), ai, req.auth!.orgId!, req.auth!.userId, id));
    }),
  );

  router.post(
    "/messages/:id/draft",
    ...pageGate,
    validateBody(brokerMailQueueDraftSchema),
    asyncHandler(async (req, res) => {
      const id = messageId(req, res);
      if (!id) return;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const r = await queueBrokerMailDraft(admin, orgId, req.auth!.userId, id, res.locals.body as BrokerMailQueueDraft);
      if (r.ok) {
        // Who put which draft in whose Outlook — the text's hash, never its words.
        await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "broker_mail.draft_queued", entity: "broker_mail_drafts", entityId: r.value.draftId, meta: { messageId: id, composedBy: r.value.composedBy } });
      }
      answer(res, r);
    }),
  );

  router.post(
    "/messages/:id/close",
    ...pageGate,
    validateBody(brokerMailCloseSchema),
    asyncHandler(async (req, res) => {
      const id = messageId(req, res);
      if (!id) return;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { how } = res.locals.body as BrokerMailClose;
      const r = await closeBrokerMail(admin, orgId, req.auth!.userId, id, how);
      if (r.ok) await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "broker_mail.closed", entity: "broker_mail_messages", entityId: id, meta: { how } });
      answer(res, r);
    }),
  );

}
