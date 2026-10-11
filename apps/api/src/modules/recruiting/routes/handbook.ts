import { Router } from "express";
import type { Request, Response } from "express";
import {
  carrierRepresentativeCreateSchema,
  handbookCountersignSchema,
  type CarrierRepresentativeCreate,
  type HandbookCountersign,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  addRepresentative,
  deleteRepresentative,
  isRepresentativeError,
  listRepresentatives,
  type RepresentativeError,
} from "../representatives.js";
import {
  countersignHandbook,
  driverHandbookStatus,
  isHandbookError,
  extendHandbookLink,
  type HandbookError,
} from "../handbookSigning.js";
import { handbookPreviewPdf } from "../handbookPreview.js";

/**
 * The driver handbook and the Representatives who sign it for the carrier — HANDBOOK-SIGNING-PLAN.md
 * HB3 (D-HB1, D-HB3).
 *
 * Gated on the RECRUITMENT section, like the road test next door: the handbook is signed at the same
 * desk on the same morning, by the office that works the hire.
 */
const repStatus = (e: RepresentativeError): number =>
  e.code === "not_found" ? 404 : e.code === "invalid_request" ? 400 : e.code === "has_signed" ? 409 : 500;

const handbookStatusCode = (e: HandbookError): number =>
  e.code === "not_found" || e.code === "representative_not_found" ? 404
  : e.code === "storage_failed" || e.code === "insert_failed" ? 500
  // Every other refusal is a perfectly good request at the wrong moment in the handbook's life.
  : 409;

export function recruitmentHandbookRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/representatives",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ representatives: await listRepresentatives(admin, req.auth!.orgId!) });
    }),
  );

  router.post(
    "/representatives",
    requireOrg,
    requireSection("recruitment"),
    validateBody(carrierRepresentativeCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await addRepresentative(admin, orgId, req.auth!.userId, res.locals.body as CarrierRepresentativeCreate);
      if (isRepresentativeError(result)) {
        res.status(repStatus(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.representative_added",
        entity: "carrier_representatives",
        entityId: result.id,
        // What the handbook prints; the signature image is never logged.
        meta: { fullName: result.full_name, title: result.title },
      });
      res.status(201).json({ representative: result });
    }),
  );

  router.delete(
    "/representatives/:representativeId",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const representativeId = String(req.params.representativeId ?? "");
      const result = await deleteRepresentative(admin, orgId, representativeId);
      if (isRepresentativeError(result)) {
        res.status(repStatus(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.representative_removed",
        entity: "carrier_representatives",
        entityId: representativeId,
        meta: {},
      });
      res.json(result);
    }),
  );

  router.get(
    "/applicants/:driverId/handbook",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await driverHandbookStatus(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isHandbookError(result)) {
        res.status(handbookStatusCode(result)).json(apiError(result.code, result.message));
        return;
      }
      res.json({ handbook: result });
    }),
  );

  // D-AW17 (C3s5): the handbook as the driver will sign it, prefilled, from the signing row. On the view
  // door like the packet's preview: printing a document changes nothing about it.
  router.get(
    "/applicants/:driverId/handbook/preview.pdf",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await handbookPreviewPdf(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isHandbookError(result)) {
        res.status(handbookStatusCode(result)).json(apiError(result.code, result.message));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.send(result.pdf);
    }),
  );

  // A-2: keep the driver's link alive while the handbook is still to be signed or countersigned. It was
  // "/handbook/open" until C3s4b, when the envelope began opening the handbook (D-AW16) and this press
  // kept only its extension (`extendHandbookLink` says why that half had to stay).
  router.post(
    "/applicants/:driverId/handbook/extend",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await extendHandbookLink(admin, orgId, driverId);
      if (isHandbookError(result)) {
        res.status(handbookStatusCode(result)).json(apiError(result.code, result.message));
        return;
      }
      // Its own row, carrying the invitation and the new expiry and nothing else — the link is a bearer
      // credential, so nothing about the token is logged. A press that changed nothing writes nothing.
      if (result.extended) {
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "recruiting.handbook_link_extended",
          entity: "application_invitations",
          entityId: result.invitationId,
          meta: { expiresAt: result.expiresAt },
        });
      }
      res.json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/handbook/countersign",
    requireOrg,
    requireSection("recruitment"),
    validateBody(handbookCountersignSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const body = res.locals.body as HandbookCountersign;
      const result = await countersignHandbook(
        admin, orgId, req.auth!.userId, req.auth!.role ?? null, driverId, body.representative_id,
      );
      if (isHandbookError(result)) {
        res.status(handbookStatusCode(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        // The actor applied the Representative's signature (D-HB3); meta names the Representative.
        action: "compliance.handbook_filed",
        entity: "qualification_records",
        entityId: result.recordId,
        // Q-HB1: the same press countersigned the packet; its copy is named so the audit row accounts
        // for both documents it filed.
        meta: { driverId, representativeId: body.representative_id, documentId: result.documentId,
          packetDocumentId: result.packetDocumentId },
      });
      res.status(201).json(result);
    }),
  );

  return router;
}
