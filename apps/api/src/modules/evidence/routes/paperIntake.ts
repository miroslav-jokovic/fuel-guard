import { Router } from "express";
import type { Request, Response } from "express";
import { isRecordId, paperStackRegisterSchema, type PaperStackRegisterRequest } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { listBatch, markQueued, registerStack } from "../intake/paperIntake.js";

/**
 * Scanned stacks of paper driver files (DRIVER-PAPER-INTAKE-PLAN PI2). Mounted inside the compliance
 * router, which has run `requireAuth`.
 *
 *   POST /paper-intake/stacks                → register one file, get a signed PUT URL (or `duplicate`)
 *   POST /paper-intake/stacks/:id/complete   → the PUT finished: queue the split
 *   GET  /paper-intake/batches/:batchId      → one drop's stacks and the pieces they were cut into
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
          payload: { stackId },
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
      res.json({ stacks: await listBatch(admin, req.auth!.orgId!, batchId) });
    }),
  );

  return router;
}
