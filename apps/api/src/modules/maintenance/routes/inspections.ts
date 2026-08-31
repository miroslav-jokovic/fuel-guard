import { Router } from "express";
import { z } from "zod";
import {
  INSPECTION_CATALOGUE_VERSION,
  inspectionCreateSchema,
  inspectionPatchSchema,
  rolesThatCanView,
  rolesThatManage,
  type InspectionCreateRequest,
  type InspectionPatchRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  createInspectionDraft,
  getInspection,
  listInspections,
  patchInspection,
} from "../inspections/inspections.js";
import { inspectorFor } from "../inspections/inspectors.js";
import { finalizeInspection } from "../inspections/finalize.js";
import { buildPreviewInput, renderOverlayReport, renderStoredReport } from "../inspections/reportDelivery.js";
import { renderRegistrationSheet } from "../inspections/render/registrationSheet.js";
import { getPrintProfile } from "../inspections/printProfiles.js";

/**
 * `/api/maintenance/inspections` — the §396.17 draft lifecycle (plan step A4).
 *
 * Reads are `rolesThatCanView("maintenance")` and writes `rolesThatManage("maintenance")`, DERIVED
 * from the matrix rather than listed here: the same sets 0280's policies carry, so the door and the
 * database cannot come to different conclusions about who a `technician` is.
 *
 * There is no finalize verb yet. Until A6 exists a report cannot leave `draft`, which is the honest
 * state of this feature rather than a gap — nothing here can produce a certification.
 */

const listSchema = z.object({
  subjectType: z.enum(["tractor", "trailer"]).optional(),
  subjectId: z.uuid().optional(),
  status: z.enum(["draft", "final"]).optional(),
  outcome: z.enum(["pass", "fail"]).optional(),
  q: z.string().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function inspectionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireRole(...rolesThatCanView("maintenance"));
  const canManage = requireRole(...rolesThatManage("maintenance"));

  router.get(
    "/",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listInspections(admin, req.auth!.orgId!, parsed.data);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, inspections: result.rows, total: result.total });
    }),
  );

  router.get(
    "/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await getInspection(admin, req.auth!.orgId!, String(req.params.id ?? ""));
      if (result && "code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      // A cross-org id must be indistinguishable from one that does not exist (the roster
      // archive route's rule) — the tenant scope is on the query, never on the result.
      if (!result) {
        res.status(404).json(apiError("not_found", "Inspection not found"));
        return;
      }
      res.json({ ok: true, inspection: result.report, items: result.items });
    }),
  );

  router.post(
    "/",
    requireOrg,
    canManage,
    validateBody(inspectionCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as InspectionCreateRequest;

      // §396.19 is asserted on the printed page, so the inspector must be able to carry it on the
      // day of the inspection — checked at the door rather than discovered at finalize (D-AVI6).
      const inspector = await inspectorFor(admin, orgId, body.inspectorId, body.inspectedOn);
      if (inspector && "code" in inspector) {
        res.status(500).json(apiError(inspector.code, inspector.error));
        return;
      }
      if (!inspector) {
        res.status(400).json(apiError("unknown_inspector", "That inspector is not on the register."));
        return;
      }
      if (!inspector.qualified) {
        res
          .status(400)
          .json(
            apiError(
              "inspector_not_qualified",
              `${inspector.full_name} has no §396.19 qualification covering ${body.inspectedOn}. Record one before inspecting under their name.`,
            ),
          );
        return;
      }

      const result = await createInspectionDraft(admin, orgId, req.auth!.userId, body);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      if (!result.replayed) {
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "maintenance.inspection_started",
          entity: "vehicle_inspections",
          entityId: result.id,
          meta: {
            subjectType: body.subjectType,
            subjectId: body.subjectId,
            inspectorId: body.inspectorId,
            inspectedOn: body.inspectedOn,
            catalogueVersion: INSPECTION_CATALOGUE_VERSION,
          },
        });
      }
      res.status(result.replayed ? 200 : 201).json({ ok: true, id: result.id });
    }),
  );

  router.patch(
    "/:id",
    requireOrg,
    canManage,
    validateBody(inspectionPatchSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const result = await patchInspection(admin, orgId, id, res.locals.body as InspectionPatchRequest);
      if ("code" in result) {
        const status = result.code === "not_found" ? 404 : result.code === "already_final" ? 409 : 500;
        res.status(status).json(apiError(result.code, result.error));
        return;
      }
      // The whole report, as the database now holds it — see patchInspection's header for why the
      // client's state is refreshed from the DB on every save rather than assumed.
      const after = await getInspection(admin, orgId, id);
      if (!after || "code" in after) {
        res.status(500).json(apiError("db_error", "Saved, but could not re-read the inspection."));
        return;
      }
      res.json({ ok: true, inspection: after.report, items: after.items });
    }),
  );

  /**
   * Certify the report (D-AVI3/D-AVI4). Every refusal is a 400 naming what to fix; a replay of an
   * already-final report answers 200 with what was filed, because from the caller's side the first
   * request succeeded.
   */
  router.post(
    "/:id/finalize",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const result = await finalizeInspection(admin, orgId, id, req.auth!.userId);
      if ("error" in result) {
        const status = result.code === "not_found" ? 404 : REFUSALS.has(result.code) ? 400 : 500;
        res.status(status).json({
          error: { code: result.code, message: result.error },
          ...("issues" in result && result.issues ? { issues: result.issues } : {}),
        });
        return;
      }
      if (result.finalized) {
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "maintenance.inspection_certified",
          entity: "vehicle_inspections",
          entityId: result.id,
          meta: {
            outcome: result.outcome,
            nextDueOn: result.nextDueOn,
            documentId: result.documentId,
            certificationId: result.certificationId,
          },
        });
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * The filed page. A final report serves its STORED bytes rather than re-rendering — the filed PDF
   * is the evidence, and regenerating it on the way to a printer would hand out a document that had
   * never been hashed into `documents.sha256`.
   */
  router.get(
    "/:id/report.pdf",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await renderStoredReport(admin, req.auth!.orgId!, String(req.params.id ?? ""));
      if ("code" in result) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.error));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.send(result.pdf);
    }),
  );

  /** D-AVI14 — the same renderer and the same map, marked DRAFT, never stored. */
  router.get(
    "/:id/preview.pdf",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const built = await buildPreviewInput(admin, req.auth!.orgId!, String(req.params.id ?? ""));
      if ("code" in built) {
        res.status(built.code === "not_found" ? 404 : 500).json(apiError(built.code, built.error));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", 'inline; filename="inspection-preview.pdf"');
      res.send(built.pdf);
    }),
  );

  /**
   * The values-only page for a pre-printed pad (D-AVI8). A different artefact for a different piece
   * of paper — the filed report above is still served exactly as it was filed.
   */
  router.get(
    "/:id/overlay.pdf",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const profileId = typeof req.query.profile === "string" ? req.query.profile : null;
      const result = await renderOverlayReport(admin, req.auth!.orgId!, String(req.params.id ?? ""), profileId);
      if ("code" in result) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.error));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.send(result.pdf);
    }),
  );

  return router;
}

/**
 * The sheet a printer is measured with — not about any one inspection, so it is mounted beside them
 * rather than under one.
 */
export function inspectionPrintingRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/registration-sheet.pdf",
    requireOrg,
    requireRole(...rolesThatManage("maintenance")),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const profileId = typeof req.query.profile === "string" ? req.query.profile : null;
      let offset = { x: 0, y: 0 };
      if (profileId) {
        const profile = await getPrintProfile(admin, req.auth!.orgId!, profileId);
        if (profile && "code" in profile) {
          res.status(500).json(apiError(profile.code, profile.error));
          return;
        }
        // Printing the sheet WITH the current offset is how somebody checks a calibration rather
        // than only setting one: the crosshairs should land dead centre if it is right.
        if (profile) offset = { x: profile.offset_x_pt, y: profile.offset_y_pt };
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", 'inline; filename="registration-sheet.pdf"');
      res.send(await renderRegistrationSheet(offset));
    }),
  );

  return router;
}

/** Refusals that mean "fix the report", not "the server broke". */
const REFUSALS = new Set([
  "already_final",
  "incomplete_components",
  "inspector_not_qualified",
  "carrier_incomplete",
  "equipment_missing",
]);
