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
  qualificationSeedSchema,
  expandQualificationSeed,
  filterAgainstExisting,
  type QualificationSeedRequest,
  type ExistingCertKey,
  canReadRestrictedKind,
  filterRestrictedRows,
  shouldDerive,
} from "@silvicom/shared";
import { randomUUID } from "node:crypto";
import { dispatchJob } from "../../../queue/dispatch.js";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  insertCertification,
  listCertifications,
  insertQualificationRecord,
  listQualificationRecords,
  registerDocument,
  listDocuments,
  signDocumentDownload,
} from "../compliance.js";
import { getComplianceOverview } from "../complianceOverview.js";
import { complianceExportsRouter } from "./complianceExports.js";

/**
 * Compliance master data API — /api/compliance/* (PLAN §3 / M1.5, Silvicom 360 slice).
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
      // Phase G (D-DQ15): recording a restricted kind is itself restricted — a role that cannot read
      // drug-test results has no business writing them either.
      if (!canReadRestrictedKind(body.kind, req.auth!.role)) {
        res
          .status(403)
          .json(apiError("forbidden", "Drug & alcohol and investigation-history records require a safety manager or admin."));
        return;
      }
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
      // Phase G (D-DQ15): this read runs on the service role, so RLS (0205) cannot narrow it — the
      // filter has to live here. Non-privileged fleet roles see no restricted rows at all.
      res.json({
        records: filterRestrictedRows(result.rows as Array<{ kind: string }>, req.auth!.role),
      });
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
      // Derivatives ride the queue, never this request (B3): the register call returns before the
      // browser has even PUT the bytes, so waiting on sharp here could only ever time out. Enqueue
      // failures are swallowed on purpose — a missing thumbnail must not fail a registration, and
      // the backfill script (B8) is the catch-all for anything the queue dropped.
      if (body.variant === "original" && shouldDerive(body.contentType)) {
        await dispatchJob(admin, getAppLocals(req).env, "document_derive", {
          orgId,
          payload: { documentId: result.documentId },
          dedupKey: `document_derive:${result.documentId}`,
          requestedBy: req.auth!.userId,
        }).catch(() => undefined);
      }
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
      // Phase G (D-DQ15): scans of restricted records are as restricted as the records. Service-role
      // read, so the filter lives here, mirroring the qualification-records list above.
      res.json({ documents: filterRestrictedRows(result.rows, req.auth!.role) });
    }),
  );

  // One document, as a DOWNLOAD (plan B6): the signed URL carries Content-Disposition: attachment
  // with the filename we choose — the only shape that downloads in every browser cross-origin.
  // Reading somebody's medical card out of the system is worth a ledger line, so it is audited,
  // and restricted kinds require the restricted read (Phase G).
  router.get(
    "/documents/:id/download",
    requireOrg,
    canView,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await signDocumentDownload(admin, orgId, String(req.params.id));
      if ("code" in result) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.error));
        return;
      }
      if (!canReadRestrictedKind(result.kind, req.auth!.role)) {
        res.status(403).json(apiError("forbidden", "Downloading restricted records requires a safety manager or admin."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.document_downloaded",
        entity: "documents",
        entityId: String(req.params.id),
        meta: { filename: result.filename },
      });
      res.json({ url: result.url, filename: result.filename });
    }),
  );

  // /exports/* — the binder and stamped-release surface, in its own module (500-line budget).
  router.use(complianceExportsRouter());

  return router;
}
