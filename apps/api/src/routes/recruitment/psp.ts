import { Router } from "express";
import {
  PSP_IMPORT_CONSENT_ATTESTATION,
  canReadInvestigationHistory,
  pspImportSchema,
  pspImportUploadSchema,
  rolesThatManage,
  type PspImport,
  type PspImportUpload,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { filePspImport, isPspImportError, registerPspImportDocument } from "../../services/pspImport.js";

/**
 * PSP records the carrier already bought on the FMCSA portal — P14.
 *
 * Two calls: register the PDF and PUT it to the signed URL, then file it. The reasoning for the
 * shape is in `services/pspImport.ts`; the reasoning for the rules is in
 * `packages/shared/src/psp/import.ts`. This file is the guard and the audit trail.
 *
 * ── WHO MAY FILE ONE, AND WHY IT IS NARROWER THAN THE SECTION ──────────────────────────────────
 * `rolesThatManage("recruitment")` is admin, fleet_manager, safety_manager and recruiter, and a
 * fleet_manager is NOT among the §391.53(a)(1) readers `canReadInvestigationHistory` names. Letting
 * them file a PSP report would mean filing evidence into a class they cannot open — they could not
 * check what they filed, correct a wrong entry, or answer a question about it, and the row would
 * carry their name as the person who attested to the consent behind a document they may not read.
 *
 * So the guard is the INTERSECTION: manage the section AND be permitted to read what you are filing.
 * Derived from both rather than listed, because a hand-written role list is how the two drift.
 */
export function recruitmentPspRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canFile = requireRole(...rolesThatManage("recruitment").filter(canReadInvestigationHistory));

  /**
   * The wording the operator is asked to affirm, served rather than hard-coded in the client — the
   * same rule as `DISCLOSURES`: what somebody attested to is a stored fact, and a client-authored
   * version of it is worth nothing when the file is reviewed.
   */
  router.get(
    "/psp-imports/attestation",
    requireOrg,
    canFile,
    asyncHandler(async (_req, res) => {
      res.json({ attestation: PSP_IMPORT_CONSENT_ATTESTATION });
    }),
  );

  router.post(
    "/psp-imports/document",
    requireOrg,
    canFile,
    validateBody(pspImportUploadSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = res.locals.body as PspImportUpload;
      const result = await registerPspImportDocument(admin, req.auth!.orgId!, req.auth!.userId, body);
      if (isPspImportError(result)) {
        res.status(result.code === "not_found" ? 404 : 400).json(apiError(result.code, result.message));
        return;
      }
      // No audit here. Registration without an upload is an intent, not an act, and the filing below
      // is the event a §391.51 review cares about — auditing both would put two entries in the log
      // for one document, one of which may never have received any bytes.
      res.status(201).json(result);
    }),
  );

  router.post(
    "/psp-imports",
    requireOrg,
    canFile,
    validateBody(pspImportSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as PspImport;

      const result = await filePspImport(
        admin, orgId, req.auth!.userId, body, new Date().toISOString().slice(0, 10),
      );
      if (isPspImportError(result)) {
        const status = result.code === "not_found" ? 404 : result.code === "insert_failed" ? 500 : 400;
        // One message, as every other router does: `validatePspImport` reports on a single
        // hand-typed field, so the first issue IS the answer.
        res.status(status).json(apiError(result.code, result.issues?.[0]?.message ?? result.message));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.psp_record_imported",
        entity: "qualification_records",
        entityId: result.recordId,
        // The provenance and the attestation, not the report. `source: portal_import` is what tells a
        // later reader this record cost nothing and came from a drawer rather than from the vendor.
        meta: {
          driverId: body.driver_id,
          documentId: result.documentId,
          obtainedOn: body.obtained_on,
          source: "portal_import",
          consentAttested: true,
        },
      });

      res.status(201).json(result);
    }),
  );

  return router;
}
