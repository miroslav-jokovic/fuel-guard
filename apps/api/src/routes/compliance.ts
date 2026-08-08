import { Router } from "express";
import type { Request, Response } from "express";
import {
  certificationCreateSchema,
  type CertificationCreateRequest,
  certificationListQuerySchema,
  documentListQuerySchema,
  documentRegisterSchema,
  type DocumentRegisterRequest,
  qualificationRecordCreateSchema,
  type QualificationRecordCreateRequest,
  rolesThatCanView,
  rolesThatManage,
  binderRequestSchema,
  type BinderRequest,
  documentExportRequestSchema,
  type DocumentExportRequest,
  dqExportListQuerySchema,
  qualificationSeedSchema,
  expandQualificationSeed,
  filterAgainstExisting,
  type QualificationSeedRequest,
  type ExistingCertKey,
} from "@fuelguard/shared";
import { randomUUID } from "node:crypto";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import {
  insertCertification,
  listCertifications,
  insertQualificationRecord,
  listQualificationRecords,
  registerDocument,
  listDocuments,
} from "../services/compliance.js";
import { getComplianceOverview } from "../services/complianceOverview.js";
import { buildDocumentExport } from "../services/dqBinder/index.js";
import {
  attachJob,
  createExport,
  listExports,
  markDone,
  markFailed,
  signExport,
} from "../services/dqExports.js";
import { dispatchJob } from "../services/queue/dispatch.js";

/**
 * Compliance master data API — /api/compliance/* (PLAN §3 / M1.5, FuelGuard slice).
 *
 * v1 = the CERTIFICATIONS surface, which is exactly what the §5 hazmat qualification gate reads.
 * Managers (the `fleet` section: admin / fleet_manager / safety_manager) write; dispatch + audit
 * read. RLS (0127) is the PostgREST backstop. Populating this table is what turns the fail-closed
 * gate into a real pass/fail: until a driver has current cdl / medical_card / endorsement /
 * hazmat_training rows here (and the carrier its phmsa_registration / financial_responsibility),
 * every hazmat load for that driver stays unclearable — the correct safe default.
 *
 * qualification_records (§3.2) and documents (DQ0) attach on this same router. `compliance_items`
 * and `master_documents` were retired by 0147 — they had no producer and no consumer.
 */
export function complianceRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("fleet"));
  const canManage = requireRole(...rolesThatManage("fleet"));
  /**
   * Who may see the export LEDGER. Wider than who may create an export — an internal auditor's whole
   * job is reading the record of what left the building — and narrower than `canView`, which includes
   * dispatch. Dispatch has access to a driver's file when they need a licence (D-BD10); a list of
   * every driver whose records have been sent out is a different thing.
   */
  const canSeeExports = requireRole("admin", "fleet_manager", "safety_manager", "auditor");
  const today = (): string => new Date().toISOString().slice(0, 10);

  // Create a certification (auto-supersedes the prior current one, §10.1). Client-generated id ⇒
  // idempotent replay. Every write is audited — these rows are the DQF a DOT auditor asks for.
  router.post(
    "/certifications",
    requireOrg,
    canManage,
    validateBody(certificationCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as CertificationCreateRequest;
      const result = await insertCertification(admin, orgId, req.auth!.userId, body);
      if ("code" in result) {
        res
          .status(result.code === "insert_failed" ? 500 : 400)
          .json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.certification_recorded",
        entity: "certifications",
        entityId: result.id,
        meta: {
          kind: body.kind,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          supersededId: result.supersededId,
          expiresAt: body.expiresAt ?? null,
        },
      });
      res.status(201).json({ id: result.id, supersededId: result.supersededId });
    }),
  );

  // ── H-CS: bulk qualification-file seeding (the F-H1 operational unlock) ───────────────────────
  // One request seeds a whole roster through the SAME schema + insert_certification supersede RPC as
  // the single-entry path — same validation, same audit surface, nothing bypassed. skipExisting
  // (default) never supersedes a richer CertManager entry with a terser seeded one.
  router.post(
    "/certifications/seed",
    requireOrg,
    canManage,
    validateBody(qualificationSeedSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as QualificationSeedRequest;

      const expansions = expandQualificationSeed(body, orgId, () => randomUUID());
      let toInsert = expansions;
      let skippedCount = 0;
      if (body.skipExisting && expansions.length > 0) {
        const { data: existing } = await admin
          .from("certifications")
          .select("subject_type, subject_id, kind, qualifier, training_type")
          .eq("org_id", orgId)
          .is("superseded_by", null);
        const filtered = filterAgainstExisting(expansions, (existing ?? []) as ExistingCertKey[]);
        toInsert = filtered.toInsert;
        skippedCount = filtered.skipped.length;
      }

      const failed: Array<{ kind: string; subjectId: string; error: string }> = [];
      let created = 0;
      for (const e of toInsert) {
        const result = await insertCertification(admin, orgId, req.auth!.userId, e.request);
        if ("code" in result) failed.push({ kind: e.request.kind, subjectId: e.request.subjectId, error: result.error });
        else created++;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.qualification_seeded",
        entity: "certifications",
        entityId: orgId,
        meta: { drivers: body.drivers.length, created, skipped: skippedCount, failed: failed.length },
      });
      res.status(failed.length > 0 && created === 0 ? 500 : 201).json({ created, skipped: skippedCount, failed });
    }),
  );

  // List certifications for a subject — current rows by default; includeHistory shows the supersede chain.
  router.get(
    "/certifications",
    requireOrg,
    canView,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = certificationListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_query", parsed.error.message));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listCertifications(admin, req.auth!.orgId!, parsed.data);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ certifications: result.rows });
    }),
  );

  // ── qualification records (append-only DQF events, §3.2) ───────────────────────────
  router.post(
    "/qualification-records",
    requireOrg,
    canManage,
    validateBody(qualificationRecordCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as QualificationRecordCreateRequest;
      const result = await insertQualificationRecord(admin, orgId, req.auth!.userId, body);
      if ("code" in result) {
        res
          .status(result.code === "insert_failed" ? 500 : 400)
          .json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.qualification_recorded",
        entity: "qualification_records",
        entityId: result.id,
        meta: { kind: body.kind, driverId: body.driverId, occurredOn: body.occurredOn },
      });
      res.status(201).json({ id: result.id });
    }),
  );

  router.get(
    "/qualification-records",
    requireOrg,
    canView,
    asyncHandler(async (req: Request, res: Response) => {
      const driverId = typeof req.query.driverId === "string" ? req.query.driverId : null;
      if (!driverId) {
        res.status(400).json(apiError("bad_query", "driverId is required"));
        return;
      }
      const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listQualificationRecords(admin, req.auth!.orgId!, driverId, kind);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ records: result.rows });
    }),
  );

  /**
   * The fleet picture (D-DQ6) — every driver's state, group rollup, and what needs attention, ranked
   * by the same function the driver file uses so the two can never disagree about what is due.
   *
   * `canView`, not `canManage`: a dispatcher planning a hazmat load needs to know who is short of
   * what without being able to change it.
   */
  router.get(
    "/overview",
    requireOrg,
    canView,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const today = new Date().toISOString().slice(0, 10);
      res.json(await getComplianceOverview(admin, req.auth!.orgId!, today));
    }),
  );

  // ── documents (DQ0) — the scan behind any record ────────────────────────────────────
  //
  // Registration returns a signed upload URL; the client PUTs the bytes straight to Storage. The
  // API never carries a 20MB scan, and the private bucket is never publicly reachable.
  router.post(
    "/documents",
    requireOrg,
    canManage,
    validateBody(documentRegisterSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as DocumentRegisterRequest;
      const result = await registerDocument(admin, orgId, req.auth!.userId, body);
      if ("code" in result) {
        res
          .status(result.code === "insert_failed" ? 500 : 400)
          .json(apiError(result.code, result.error));
        return;
      }
      // Audited like the certifications it backs: who put which document into whose safety file, and
      // the hash that says the bytes have not changed since.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.document_registered",
        entity: "documents",
        entityId: result.documentId,
        meta: {
          kind: body.kind,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          sha256: body.sha256,
          page: body.page,
        },
      });
      res.status(201).json(result);
    }),
  );

  // Documents for one subject, each with a five-minute signed URL. One batch Storage call.
  router.get(
    "/documents",
    requireOrg,
    canView,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = documentListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_query", parsed.error.message));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listDocuments(admin, req.auth!.orgId!, parsed.data);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ documents: result.rows });
    }),
  );

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

      const created = await createExport(admin, orgId, req.auth!.userId, {
        kind: "binder",
        driverIds: body.driverIds,
        asAt,
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
        meta: { driverIds: body.driverIds, asAt, jobId: job.jobId },
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
