import { Router } from "express";
import type { Request, Response } from "express";
import { applicantDocumentUploadSchema, shouldDerive, type ApplicantDocumentUpload } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import {
  isApplicantDocumentsError,
  listApplicantDocuments,
  registerApplicantDocument,
} from "../applicantDocuments.js";

/**
 * The Documents section of the applicant record (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P9). The service
 * (`applicantDocuments.ts`) carries why this is a recruitment door; this file is the guard and the audit.
 *
 * GET = `recruitment: view`, POST = `recruitment: manage` — the section the applicant board answers to,
 * so a recruiter (`roster: view`) can file a TWIC without being handed the roster's writes. The kind is
 * composed from the slot, and nothing on the list is a restricted kind (`applicantDocumentsContract`
 * test "produces no restricted kind"), so the section is the whole of the gate for the write.
 */
export function recruitmentApplicantDocumentsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/applicants/:driverId/documents",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listApplicantDocuments(
        admin, req.auth!.orgId!, String(req.params.driverId ?? ""), req.auth!.role,
      );
      if (isApplicantDocumentsError(result)) {
        res.status(404).json(apiError(result.code, result.message));
        return;
      }
      // Five-minute URLs to identity papers: never kept by a browser or a proxy.
      res.setHeader("Cache-Control", "no-store");
      res.json({ documents: result });
    }),
  );

  router.post(
    "/applicants/:driverId/documents",
    requireOrg,
    requireSection("recruitment"),
    validateBody(applicantDocumentUploadSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const body = res.locals.body as ApplicantDocumentUpload;
      const result = await registerApplicantDocument(admin, orgId, req.auth!.userId, driverId, body);
      if ("code" in result) {
        const status = result.code === "not_found" ? 404 : result.code === "insert_failed" || result.code === "sign_failed" ? 500 : 400;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      // The same ledger line as the compliance route's registration: who put which paper into whose
      // file, and the hash that says the bytes have not changed since.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.document_registered",
        entity: "documents",
        entityId: result.documentId,
        meta: { kind: result.kind, subjectType: "driver", subjectId: driverId, sha256: body.sha256, via: "applicant_record" },
      });
      // Thumbnails ride the queue, as on the compliance route; a dropped enqueue costs a thumbnail.
      if (shouldDerive(body.content_type)) {
        await dispatchJob(admin, getAppLocals(req).env, "document_derive", {
          orgId,
          payload: { documentId: result.documentId },
          dedupKey: `document_derive:${result.documentId}`,
          requestedBy: req.auth!.userId,
        }).catch(() => undefined);
      }
      res.status(201).json({
        documentId: result.documentId, storagePath: result.storagePath, uploadUrl: result.uploadUrl, token: result.token,
      });
    }),
  );

  return router;
}
