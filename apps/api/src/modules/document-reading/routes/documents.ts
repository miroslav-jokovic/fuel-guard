import { Router, type Request, type Response } from "express";
import {
  completeSourceRequestSchema,
  createAssemblyRequestSchema,
  createReadRequestSchema,
  createSourceRequestSchema,
  reviewBatchRequestSchema,
  type CompleteSourceRequest,
  type CreateAssemblyRequest,
  type CreateReadRequest,
  type CreateSourceRequest,
  type ReviewBatchRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { readDispatcher } from "../dispatch.js";
import { intakeDedupKey, registerUpload, sourceStatus } from "../intake/intake.js";
import { createAssembly } from "../read/assemblies.js";
import type { ReadTarget } from "../read/readTarget.js";
import { getRead, isReaderError, recordReviews, requestRead, type ReaderError } from "../read/requests.js";

/**
 * `/api/documents` — the document reader's routes (DOCUMENT-READER-PLAN §2, Step 1.6b).
 *
 * WHO: the routes serve one consumer today, the Hazmat Calculator's prefill, so they carry its gate —
 * the `hazmatguard` module and the `hazmat` section from the APP_SECTIONS matrix (`manage` to send a
 * document or record a verdict, `view` to look at a read), never a role list of their own. That is
 * Q-DR18's default: a read belongs to the consumer that asked for it. When a second consumer (stop
 * readiness, Phase 6) arrives, the gate becomes the requesting consumer's, per Q-DR18's ruling — these
 * guards are where that lands, and `documentRead.ts`'s GATES is where the worker's side does.
 *
 * The worker re-checks the consumer's gate (entitlement, `extractionEnabled`, budget) before any model
 * spend; a read requested while reading is switched off ends `failed: reading_disabled` without a call.
 */

const STATUS: Record<string, number> = {
  not_found: 404,
  not_reviewable: 409,
  invalid_review: 400,
  invalid_assembly: 400,
  edited_elsewhere: 409,
  sign_failed: 502,
  query_failed: 500,
  insert_failed: 500,
};
const send = (res: Response, e: Pick<ReaderError, "error"> & { code: string }): void => {
  res.status(STATUS[e.code] ?? 500).json(apiError(e.code, e.error));
};
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id that is not a uuid is "not found" before it reaches PostgREST, which would answer 400/500. */
const idParam = (req: Request, res: Response): string | null => {
  const id = String(req.params.id ?? "");
  if (UUID_RX.test(id)) return id;
  res.status(404).json(apiError("not_found", "Not found."));
  return null;
};

export function documentsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("hazmatguard"));
  const canView = requireSection("hazmat", "view");
  const canManage = requireSection("hazmat");

  /** Register an upload: a signed PUT URL, or the source this org already holds for these bytes. */
  router.post(
    "/sources",
    canManage,
    validateBody(createSourceRequestSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = res.locals.body as CreateSourceRequest;
      const out = await registerUpload(admin, req.auth!.orgId!, body);
      if (isReaderError(out)) return send(res, out);
      res.status(out.duplicate ? 200 : 201).json(out);
    }),
  );

  /** The bytes are uploaded: queue the intake (render + store + optional read). 202 + jobId. */
  router.post(
    "/sources/:id/complete",
    canManage,
    validateBody(completeSourceRequestSchema),
    asyncHandler(async (req, res) => {
      const sourceId = idParam(req, res);
      if (!sourceId) return;
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;
      const body = res.locals.body as CompleteSourceRequest;
      const started = await dispatchJob(admin, env, "document_intake", {
        orgId,
        payload: { sourceId, sha256: body.sha256, profile: body.profile, requestedBy: userId },
        dedupKey: intakeDedupKey(sourceId),
        requestedBy: userId,
      });
      if ("conflict" in started) {
        res.status(409).json(apiError("already_running", "This document is already being prepared."));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: userId, action: "document.intake_started", entity: "document_source", entityId: sourceId,
        meta: { profile: body.profile, jobId: started.jobId },
      });
      res.status(202).json({ jobId: started.jobId });
    }),
  );

  router.get(
    "/sources/:id",
    canView,
    asyncHandler(async (req, res) => {
      const sourceId = idParam(req, res);
      if (!sourceId) return;
      const out = await sourceStatus(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, sourceId);
      if (isReaderError(out)) return send(res, out);
      res.json(out);
    }),
  );

  /**
   * Say which pages, in which order, are one document (D-DR14): the sender's files in their order, or a
   * reviewer's edit of an assembly. 201 + the assembly; a read of it is then `POST /reads { assemblyId }`.
   */
  router.post(
    "/assemblies",
    canManage,
    validateBody(createAssemblyRequestSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;
      const body = res.locals.body as CreateAssemblyRequest;
      const out = await createAssembly(admin, orgId, userId, body);
      if (isReaderError(out)) return send(res, out);
      await writeAudit(admin, {
        orgId, actorId: userId, action: "document.assembly_created", entity: "document_assembly", entityId: out.assemblyId,
        meta: "sourceIds" in body
          ? { madeBy: "sender", sourceIds: body.sourceIds, pageCount: out.pageCount }
          : { madeBy: "reviewer", supersedes: body.supersedes, pageCount: out.pageCount },
      });
      res.status(201).json(out);
    }),
  );

  /** Queue a read of a rendered source or of an assembly (0455) — a first read, or a re-read after review. */
  router.post(
    "/reads",
    canManage,
    validateBody(createReadRequestSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;
      const body = res.locals.body as CreateReadRequest;
      const target: ReadTarget = "assemblyId" in body ? { kind: "assembly", id: body.assemblyId } : { kind: "source", id: body.sourceId };
      const out = await requestRead(admin, orgId, userId, target, body.profile, readDispatcher(admin, env, orgId, userId));
      if (isReaderError(out)) return send(res, out);
      if (!out.reused) {
        await writeAudit(admin, {
          orgId, actorId: userId, action: "document.read_requested", entity: "document_read", entityId: out.readId,
          meta: { [target.kind === "source" ? "sourceId" : "assemblyId"]: target.id, profile: body.profile },
        });
      }
      res.status(out.reused ? 200 : 201).json({ readId: out.readId });
    }),
  );

  router.get(
    "/reads/:id",
    canView,
    asyncHandler(async (req, res) => {
      const readId = idParam(req, res);
      if (!readId) return;
      const out = await getRead(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, readId);
      if (isReaderError(out)) return send(res, out);
      res.json(out);
    }),
  );

  /** One review batch (a Calculate press, plan §6): each field confirmed, corrected or unreadable. */
  router.post(
    "/reads/:id/reviews",
    canManage,
    validateBody(reviewBatchRequestSchema),
    asyncHandler(async (req, res) => {
      const readId = idParam(req, res);
      if (!readId) return;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;
      const body = res.locals.body as ReviewBatchRequest;
      const out = await recordReviews(admin, orgId, userId, readId, body);
      if (isReaderError(out)) return send(res, out);
      const actions = body.reviews.reduce<Record<string, number>>((n, r) => ({ ...n, [r.action]: (n[r.action] ?? 0) + 1 }), {});
      await writeAudit(admin, {
        orgId, actorId: userId, action: "document.read_reviewed", entity: "document_read", entityId: readId,
        meta: { consumer: body.consumer, ...actions },
      });
      res.status(201).json(out);
    }),
  );

  return router;
}
