import { Router } from "express";
import type { Request, Response } from "express";
import {
  isRecordId,
  paperDiscardRequestSchema,
  paperFileRequestSchema,
  paperStackRegisterSchema,
  type PaperDiscardRequest,
  type PaperFileRequest,
  type PaperStackRegisterRequest,
} from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { markQueued, registerStack } from "../intake/paperIntake.js";
import { listBatch, pieceUrl } from "../intake/paperIntakeBatch.js";
import { discardIntakeItem, fileIntakeItem, type FilingError } from "../intake/paperIntakeFiling.js";

/**
 * Scanned stacks of paper driver files (DRIVER-PAPER-INTAKE-PLAN PI2). Mounted inside the compliance
 * router, which has run `requireAuth`.
 *
 *   POST /paper-intake/stacks                → register one file, get a signed PUT URL (or `duplicate`)
 *   POST /paper-intake/stacks/:id/complete   → the PUT finished: queue the split
 *   GET  /paper-intake/batches/:batchId      → one drop's stacks, their pieces, and its review rows (PI4)
 *   GET  /paper-intake/stacks/:id/parts/:i   → a signed URL to one piece's PDF, for the viewer (PI4)
 *   POST /paper-intake/items/:id/file        → file a reviewed paper into the driver's file (PI5)
 *   POST /paper-intake/items/:id/discard     → set a row aside (PI5)
 *
 * Every route is `roster: manage`: these are papers on their way into drivers' files, the section's
 * write (D-UF5), and the review that follows (PI4) is the same reader — Q-PI5's safety manager and
 * admin, who both hold it.
 */
export function paperIntakeRouter(): Router {
  const router = Router();
  const gate = [requireOrg, requireSection("roster", "manage")];

  router.post(
    "/paper-intake/stacks",
    ...gate,
    validateBody(paperStackRegisterSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const body = res.locals.body as PaperStackRegisterRequest;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await registerStack(admin, orgId, req.auth!.userId, body);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      if (!result.duplicate) {
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "compliance.paper_stack_registered",
          entity: "paper_intake_stacks",
          entityId: result.stackId,
          meta: { fileName: body.fileName, sha256: body.sha256, bytes: body.bytes, batchId: body.batchId },
        });
      }
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
  );

  router.post(
    "/paper-intake/stacks/:id/complete",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const stackId = String(req.params.id);
      if (!isRecordId(stackId)) {
        res.status(400).json(apiError("bad_id", "Not an upload id."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await markQueued(admin, orgId, stackId);
      if (typeof result !== "string") {
        res.status(result.code === "not_found" ? 404 : result.code === "not_uploadable" ? 409 : 500).json(apiError(result.code, result.error));
        return;
      }
      if (result === "queued") {
        // Deduplicated on the stack: a double-click or a retried request queues one split.
        await dispatchJob(admin, env, "paper_intake_split", {
          orgId,
          payload: { stackId, requestedBy: req.auth!.userId },
          dedupKey: `paper_intake_split:${stackId}`,
          requestedBy: req.auth!.userId,
        });
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "compliance.paper_stack_queued",
          entity: "paper_intake_stacks",
          entityId: stackId,
          meta: {},
        });
      }
      res.status(202).json({ stackId, status: "queued" });
    }),
  );

  router.get(
    "/paper-intake/batches/:batchId",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const batchId = String(req.params.batchId);
      if (!isRecordId(batchId)) {
        res.status(400).json(apiError("bad_id", "Not a batch id."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await listBatch(admin, req.auth!.orgId!, batchId));
    }),
  );

  // One piece's PDF, signed for five minutes, for the review page's viewer (PI4).
  router.get(
    "/paper-intake/stacks/:id/parts/:index",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const stackId = String(req.params.id);
      const index = Number(req.params.index);
      if (!isRecordId(stackId) || !Number.isInteger(index) || index < 0) {
        res.status(400).json(apiError("bad_id", "Not a piece of an upload."));
        return;
      }
      const url = await pieceUrl(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, stackId, index);
      if (!url) {
        res.status(404).json(apiError("not_found", "That piece is not on file."));
        return;
      }
      res.json({ url });
    }),
  );

  const filingStatus = (e: FilingError) =>
    ({ not_found: 404, already_decided: 409, refused: 422, forbidden: 403, piece_missing: 409, failed: 500 })[e.code];

  router.post(
    "/paper-intake/items/:id/file",
    ...gate,
    validateBody(paperFileRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const itemId = String(req.params.id);
      if (!isRecordId(itemId)) {
        res.status(400).json(apiError("bad_id", "Not a paper of an upload."));
        return;
      }
      const body = res.locals.body as PaperFileRequest;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await fileIntakeItem(admin, orgId, { id: req.auth!.userId, role: req.auth!.role ?? null }, itemId, body);
      if ("code" in result) {
        res.status(filingStatus(result)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: result.status === "filed" ? "compliance.paper_filed" : "compliance.paper_duplicate",
        entity: "file_intake_items",
        entityId: itemId,
        meta: { driverId: body.driverId, kind: body.kind, date: body.date, expiresOn: body.expiresOn, ...result },
      });
      res.status(result.status === "filed" ? 201 : 200).json(result);
    }),
  );

  router.post(
    "/paper-intake/items/:id/discard",
    ...gate,
    validateBody(paperDiscardRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const itemId = String(req.params.id);
      if (!isRecordId(itemId)) {
        res.status(400).json(apiError("bad_id", "Not a paper of an upload."));
        return;
      }
      const body = res.locals.body as PaperDiscardRequest;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await discardIntakeItem(admin, orgId, req.auth!.userId, itemId, body);
      if ("code" in result) {
        res.status(filingStatus(result)).json(apiError(result.code, result.error));
        return;
      }
      // The row has no reason column; the reason a page was set aside lives in the audit row.
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "compliance.paper_discarded", entity: "file_intake_items", entityId: itemId, meta: { reason: body.reason } });
      res.json(result);
    }),
  );

  return router;
}
