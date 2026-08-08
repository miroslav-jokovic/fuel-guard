import { Router } from "express";
import {
  createThreadRequestSchema,
  reportMessageRequestSchema,
  sendMessageRequestSchema,
} from "@fuelguard/shared";
import { requireAuth, requireOrg } from "../middleware/auth.js";
import { driverWriteLimit } from "../middleware/driverWriteLimit.js";
import { requireModule } from "../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { createThread, getThread, listThreads, markThreadRead, sendMessage } from "../services/messages.js";

/**
 * Messages (Phase 5M, D54). ONE router for both sides — a driver and a dispatcher are participants
 * in the same conversation, so splitting this into `/me/messages` and `/dispatch/messages` would
 * mean two implementations of the same thing drifting apart.
 *
 * Access is by PARTICIPATION, not by role: the service checks membership of the thread, and RLS
 * enforces the same predicate for anything that reaches PostgREST directly. A manager who is not in
 * the thread does not read it — this is correspondence, not fleet data.
 */
export function messagesRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("messages"));
  // D57: message writes share the driver write budget (20/min, 300/day).
  router.use(driverWriteLimit());

  const param = (req: { params: Record<string, unknown> }, name: string): string => {
    const v = req.params[name];
    return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  };

  /** The inbox: every thread this user is in, with their own unread count. */
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await listThreads(admin, req.auth!.orgId!, req.auth!.userId));
    }),
  );

  /** One conversation. 404 rather than 403 for a thread you are not in — do not confirm it exists. */
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await getThread(admin, req.auth!.orgId!, req.auth!.userId, param(req, "id"));
      if (!result) {
        res.status(404).json(apiError("not_found", "That conversation does not exist"));
        return;
      }
      res.json(result);
    }),
  );

  /**
   * Start a conversation. The body carries no participant list by design — the server resolves the
   * audience (see `services/messages.ts`). Both ids are client UUIDs, so a queued offline "start a
   * conversation" that drains twice creates exactly one thread.
   */
  router.post(
    "/",
    validateBody(createThreadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof createThreadRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await createThread(
        admin,
        req.auth!.orgId!,
        req.auth!.userId,
        req.auth!.role === "driver",
        body,
      );
      if (!result.ok) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ thread_id: result.threadId });
    }),
  );

  router.post(
    "/:id/messages",
    validateBody(sendMessageRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof sendMessageRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await sendMessage(admin, req.auth!.orgId!, req.auth!.userId, param(req, "id"), body);
      if (!result.ok) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    "/:id/read",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      await markThreadRead(admin, param(req, "id"), req.auth!.userId);
      res.json({ ok: true });
    }),
  );

  /**
   * Report a message (Apple 1.2 — in-app UGC needs a report affordance even for an internal app).
   * Audited so an admin can act on it; deliberately no auto-moderation a fleet does not need.
   */
  router.post(
    "/messages/:messageId/report",
    validateBody(reportMessageRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof reportMessageRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const messageId = param(req, "messageId");

      const { error } = await admin.from("message_reports").insert({
        org_id: req.auth!.orgId!,
        message_id: messageId,
        reported_by: req.auth!.userId,
        reason: body.reason,
      });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not submit that report"));
        return;
      }
      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: "message.reported",
        entity: "messages",
        entityId: messageId,
        meta: { reason: body.reason, ...(body.note ? { note: body.note } : {}) },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
