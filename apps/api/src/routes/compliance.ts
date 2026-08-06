import { Router } from "express";
import type { Request, Response } from "express";
import {
  certificationCreateSchema, type CertificationCreateRequest,
  certificationListQuerySchema,
  qualificationRecordCreateSchema, type QualificationRecordCreateRequest,
  rolesThatCanView, rolesThatManage,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { insertCertification, listCertifications, insertQualificationRecord, listQualificationRecords } from "../services/compliance.js";

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
 * qualification_records / documents / compliance_items (the rest of M1) attach on this router later.
 */
export function complianceRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("fleet"));
  const canManage = requireRole(...rolesThatManage("fleet"));

  // Create a certification (auto-supersedes the prior current one, §10.1). Client-generated id ⇒
  // idempotent replay. Every write is audited — these rows are the DQF a DOT auditor asks for.
  router.post("/certifications", requireOrg, canManage, validateBody(certificationCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const orgId = req.auth!.orgId!;
    const body = res.locals.body as CertificationCreateRequest;
    const result = await insertCertification(admin, orgId, req.auth!.userId, body);
    if ("code" in result) { res.status(result.code === "insert_failed" ? 500 : 400).json(apiError(result.code, result.error)); return; }
    await writeAudit(admin, {
      orgId, actorId: req.auth!.userId, action: "compliance.certification_recorded",
      entity: "certifications", entityId: result.id,
      meta: { kind: body.kind, subjectType: body.subjectType, subjectId: body.subjectId, supersededId: result.supersededId, expiresAt: body.expiresAt ?? null },
    });
    res.status(201).json({ id: result.id, supersededId: result.supersededId });
  }));

  // List certifications for a subject — current rows by default; includeHistory shows the supersede chain.
  router.get("/certifications", requireOrg, canView, asyncHandler(async (req: Request, res: Response) => {
    const parsed = certificationListQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json(apiError("bad_query", parsed.error.message)); return; }
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await listCertifications(admin, req.auth!.orgId!, parsed.data);
    if ("code" in result) { res.status(500).json(apiError(result.code, result.error)); return; }
    res.json({ certifications: result.rows });
  }));

  // ── qualification records (append-only DQF events, §3.2) ───────────────────────────
  router.post("/qualification-records", requireOrg, canManage, validateBody(qualificationRecordCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const orgId = req.auth!.orgId!;
    const body = res.locals.body as QualificationRecordCreateRequest;
    const result = await insertQualificationRecord(admin, orgId, req.auth!.userId, body);
    if ("code" in result) { res.status(result.code === "insert_failed" ? 500 : 400).json(apiError(result.code, result.error)); return; }
    await writeAudit(admin, {
      orgId, actorId: req.auth!.userId, action: "compliance.qualification_recorded",
      entity: "qualification_records", entityId: result.id,
      meta: { kind: body.kind, driverId: body.driverId, occurredOn: body.occurredOn },
    });
    res.status(201).json({ id: result.id });
  }));

  router.get("/qualification-records", requireOrg, canView, asyncHandler(async (req: Request, res: Response) => {
    const driverId = typeof req.query.driverId === "string" ? req.query.driverId : null;
    if (!driverId) { res.status(400).json(apiError("bad_query", "driverId is required")); return; }
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await listQualificationRecords(admin, req.auth!.orgId!, driverId, kind);
    if ("code" in result) { res.status(500).json(apiError(result.code, result.error)); return; }
    res.json({ records: result.rows });
  }));

  return router;
}
