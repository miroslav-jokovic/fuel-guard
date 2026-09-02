import { Router } from "express";
import type { Request, Response } from "express";
import {
  binderRequestSchema,
  type BinderRequest,
  documentExportRequestSchema,
  type DocumentExportRequest,
  dqExportListQuerySchema,
  canReadAllRestricted,
  canReadRestrictedKind,
  DQ_ITEMS,
} from "@silvicom/shared";
import { requireSection, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { buildDocumentExport } from "../dqBinder/index.js";
import {
  attachJob,
  createExport,
  listExports,
  markDone,
  markFailed,
  signExport,
} from "../dqExports.js";
import { dispatchJob } from "../../../queue/dispatch.js";

/**
 * DQ exports — the /api/compliance/exports/* surface (DQ-BINDER-PLAN), split out of
 * compliance.ts when Phase G pushed that file over the 500-line budget. Same mount, same paths,
 * same guards; the parent router has already applied requireAuth.
 */
export function complianceExportsRouter(): Router {
  const router = Router();

  const canManage = requireSection("roster");
  /**
   * Who may see the export LEDGER. Wider than who may create an export — an internal auditor's whole
   * job is reading the record of what left the building — and narrower than the fleet section's
   * canView, which includes dispatch. Dispatch has access to a driver's file when they need a
   * licence (D-BD10); a list of every driver whose records have been sent out is a different thing.
   */
  const canSeeExports = requireRole("admin", "fleet_manager", "safety_manager", "auditor");
  const today = (): string => new Date().toISOString().slice(0, 10);

  // ── exports (DQ-BINDER-PLAN) ───────────────────────────────────────────────────────
  //
  // The auditor's ask, in one action: name a sample, get their §391.51 files as one PDF, in the
  // order named. The ledger row is written FIRST and the job is enqueued against it, so a crash
  // between the two leaves a visible queued export rather than nothing at all.
  router.post(
    "/exports/binder",
    requireOrg,
    canManage,
    validateBody(binderRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as BinderRequest;
      const asAt = body.asAt ?? today();
      // Phase G (D-DQ15): the default binder carries no restricted pages; including them is an
      // explicit, privileged, ledgered ask.
      // BOTH halves of the split (auth.ts): `dq_exports.include_restricted` is one boolean on a
      // ledger row rendered later by a worker with no requester in hand, so a partial entitlement
      // cannot be expressed in the artifact. A recruiter reads investigation history in the app and
      // does not export a restricted binder.
      const includeRestricted = body.includeRestricted === true;
      if (includeRestricted && !canReadAllRestricted(req.auth!.role)) {
        res
          .status(403)
          .json(apiError("forbidden", "Including restricted records requires a safety manager or admin."));
        return;
      }

      const created = await createExport(admin, orgId, req.auth!.userId, {
        kind: "binder",
        driverIds: body.driverIds,
        asAt,
        includeRestricted,
      });
      if ("code" in created) {
        res.status(500).json(apiError(created.code, created.error));
        return;
      }

      // Dedup on the EXPORT, not on (org, kind): two auditors' samples are two different questions and
      // must be allowed to run at once, while a double-submit of the same one must not.
      const job = await dispatchJob(admin, env, "dq_binder", {
        orgId,
        payload: { exportId: created.id },
        dedupKey: `dq_binder:${created.id}`,
        requestedBy: req.auth!.userId,
      });
      if ("conflict" in job) {
        res.status(409).json(apiError("job_conflict", "That binder is already being assembled."));
        return;
      }
      await attachJob(admin, created.id, job.jobId);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.binder_requested",
        entity: "dq_exports",
        entityId: created.id,
        meta: { driverIds: body.driverIds, asAt, jobId: job.jobId, includeRestricted },
      });
      res.status(202).json({ exportId: created.id, jobId: job.jobId });
    }),
  );

  // One requirement, stamped and streamed (D-BD10). Synchronous on purpose — it is one document, and
  // a job for it would make the dispatcher wait for a queue to answer a question they asked out loud.
  router.post(
    "/exports/document",
    requireOrg,
    canManage,
    validateBody(documentExportRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as DocumentExportRequest;
      const asAt = body.asAt ?? today();
      // Phase G (D-DQ15): releasing the evidence behind a restricted requirement is a privileged act.
      const spec = DQ_ITEMS.find((i) => i.key === body.requirementKey);
      // Per KIND here, unlike the binder above: this releases ONE requirement's evidence, so the
      // reader's entitlement for that requirement is exactly the question, and a recruiter may
      // release a previous-employer response under §391.53(a)(1).
      if (spec?.evidenceKinds.some((k) => !canReadRestrictedKind(k, req.auth!.role))) {
        res
          .status(403)
          .json(apiError("forbidden", "You are not permitted to release the evidence behind this requirement."));
        return;
      }

      const created = await createExport(admin, orgId, req.auth!.userId, {
        kind: "document",
        driverIds: [body.driverId],
        asAt,
        requirementKey: body.requirementKey,
      });
      if ("code" in created) {
        res.status(500).json(apiError(created.code, created.error));
        return;
      }

      try {
        const out = await buildDocumentExport(admin, orgId, body.driverId, body.requirementKey, {
          exportId: created.id,
          asAt,
          generatedAt: new Date().toISOString(),
          generatedBy: req.auth!.email ?? req.auth!.userId,
        });
        // Nothing is STORED: the bytes go straight to the caller. The ledger row is the record, and a
        // released page that is not also sitting in a bucket is one fewer copy to expire (D-BD4).
        await markDone(admin, created.id, {
          storagePath: null,
          bytes: out.bytes.byteLength,
          pages: out.pages,
          driversCount: 1,
          documentsCount: 1,
          gapsCount: 0,
        });
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "compliance.document_released",
          entity: "dq_exports",
          entityId: created.id,
          meta: {
            driverId: body.driverId,
            requirementKey: body.requirementKey,
            documentId: out.documentId,
            asAt,
          },
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${body.requirementKey}-${asAt}.pdf"`,
        );
        res.send(out.bytes);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not produce the document.";
        await markFailed(admin, created.id, message);
        res.status(400).json(apiError("export_failed", message));
      }
    }),
  );

  router.get(
    "/exports",
    requireOrg,
    canSeeExports,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = dqExportListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_query", parsed.error.message));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listExports(admin, req.auth!.orgId!, parsed.data.limit);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ exports: result.rows });
    }),
  );

  // The ONLY way the bytes are reachable — the bucket has no client policy at all. Reading a binder
  // is itself worth a ledger line, because "who downloaded it" and "who made it" are not the same
  // question six months later.
  router.get(
    "/exports/:id/download",
    requireOrg,
    canSeeExports,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await signExport(admin, orgId, String(req.params.id));
      if ("code" in result) {
        const status =
          result.code === "not_found"
            ? 404
            : result.code === "not_ready"
              ? 409
              : result.code === "expired"
                ? 410
                : 500;
        res.status(status).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.binder_downloaded",
        entity: "dq_exports",
        entityId: String(req.params.id),
        meta: {},
      });
      res.json(result);
    }),
  );

  return router;
}
