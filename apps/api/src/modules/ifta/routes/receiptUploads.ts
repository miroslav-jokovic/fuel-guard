import type { Router } from "express";
import { z } from "zod";
import {
  iftaReceiptUploadRequestSchema, iftaReceiptVoidRequestSchema,
  type IftaReceiptUploadRequest,
} from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { ReceiptUploadError, runReceiptUpload } from "../receiptUpload.js";
import { listUploads, voidUpload } from "../uploadedReceipts.js";

const idParam = z.object({ id: z.uuid() });

/**
 * Driver-paid fuel uploads (IFTA-PRECISION-PLAN IP8). Seeing the list is the IFTA page's own gate,
 * fuel `view`. Uploading and voiding are fuel `manage`: either one moves the carrier's tax-paid
 * credit, which is a write to the fuel section's numbers, not a read of them.
 */
export function registerReceiptUploadRoutes(router: Router): void {
  router.get(
    "/receipt-uploads",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, uploads: await listUploads(admin, req.auth!.orgId!) });
    }),
  );

  /** `commit: false` previews; `commit: true` lands the same rows. Only a commit is audited — a preview writes nothing. */
  router.post(
    "/receipt-uploads",
    requireOrg,
    requireSection("fuel"),
    validateBody(iftaReceiptUploadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as Required<IftaReceiptUploadRequest>;
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId ?? null;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      try {
        const result = await runReceiptUpload(admin, orgId, { ...body, actorId });
        if (result.committed) {
          await writeAudit(admin, {
            orgId,
            actorId,
            action: "ifta.receipts_uploaded",
            entity: "ifta_fuel_receipt_upload",
            entityId: result.committed.uploadId,
            meta: {
              fileName: result.fileName,
              fileSha256: result.fileSha256,
              format: result.format,
              imported: result.committed.imported,
              alreadyPresent: result.committed.alreadyPresent,
              refused: result.refused.length,
              trucksChosen: Object.keys(body.truckChoices).length,
            },
          });
        }
        res.json({ ok: true, ...result });
      } catch (e) {
        if (e instanceof ReceiptUploadError) {
          res.status(e.status).json(apiError(e.status === 400 ? "bad_request" : "unprocessable", e.message));
          return;
        }
        throw e;
      }
    }),
  );

  router.post(
    "/receipt-uploads/:id/void",
    requireOrg,
    requireSection("fuel"),
    validateBody(iftaReceiptVoidRequestSchema),
    asyncHandler(async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) {
        res.status(400).json(apiError("bad_request", "Unknown upload."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId ?? null;
      const { reason } = res.locals.body as { reason: string };
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const out = await voidUpload(admin, orgId, params.data.id, actorId, reason);
      if (!out.voided) {
        res.status(404).json(apiError("not_found", "No live upload with that id."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "ifta.receipt_upload_voided",
        entity: "ifta_fuel_receipt_upload",
        entityId: params.data.id,
        meta: { reason, receiptsVoided: out.receipts },
      });
      res.json({ ok: true, receiptsVoided: out.receipts });
    }),
  );
}
