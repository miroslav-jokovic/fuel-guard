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
  inspectionDeleteRequestSchema,
  type InspectionDeleteRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  createCorrection,
  createInspectionDraft,
  discardDraft,
  getInspection,
  patchInspection,
} from "../inspections/inspections.js";
import { listInspections } from "../inspections/inspectionList.js";
import { inspectorFor } from "../inspections/inspectors.js";
import { finalizeInspection } from "../inspections/finalize.js";
import { buildPreviewInput, renderOverlayReport, renderStoredReport } from "../inspections/reportDelivery.js";
import { deleteInspectionRecord } from "../inspections/deleteRecord.js";
import { renderRegistrationSheet } from "../inspections/render/registrationSheet.js";
import { RENDERER_VERSION } from "../inspections/render/report.js";
import { getEquipmentIdentity } from "../../roster/index.js";
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

const correctSchema = z.object({ id: z.uuid() });

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
      // `currentRendererVersion` is what the API would DRAW today. A final report serves its stored
      // bytes and is never re-rendered, so a filing drawn under an older renderer is a different page
      // from the preview beside it — which is what the office reported. Sending the current version
      // with the report is what lets the form say so, without the client keeping its own copy of it
      // (0284, D-AVI14).
      /**
       * `unit_number` is RESOLVED here, not carried on the row.
       *
       * `vehicle_inspections` holds `subject_id`, a uuid, and nobody reads those. The LIST route has
       * always resolved the unit through `roster` — the detail route did not, while the web type
       * `InspectionDetail extends InspectionSummary` declared the field anyway. That type was a
       * lie, and the first thing to actually read it broke: the delete drawer asks somebody to type
       * the unit back, got an empty string, and no input could ever match it (reported 2026-09-01).
       * Pinned by "carries the unit number, because the row only has a uuid and nobody reads those".
       */
      const equipment = await getEquipmentIdentity(
        admin,
        req.auth!.orgId!,
        result.report.subject_type,
        String(result.report.subject_id),
      );
      const unitNumber = equipment && !("code" in equipment) ? equipment.unitNumber : null;

      res.json({
        ok: true,
        inspection: { ...result.report, unit_number: unitNumber },
        items: result.items,
        currentRendererVersion: RENDERER_VERSION,
      });
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
        // A reused decal serial is the office's mistake to fix, not a server fault — 409 with the
        // sentence naming what to check (0280's unique index; plan §6 Q1).
        res.status(result.code === "duplicate_decal" ? 409 : 500).json(apiError(result.code, result.error));
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
        const status =
          result.code === "not_found" ? 404 : result.code === "already_final" || result.code === "duplicate_decal" ? 409 : 500;
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
      res.json({ ok: true, inspection: after.report, items: after.items, currentRendererVersion: RENDERER_VERSION });
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
   * Start the report that supersedes a completed one (D-AVI4).
   *
   * The other half of immutability: a finalized report cannot be edited, and this is how it gets
   * corrected. The new draft is seeded from the superseded answers, so somebody fixing one mark does
   * not walk fifty-six rows again.
   */
  router.post(
    "/:id/correct",
    requireOrg,
    canManage,
    validateBody(correctSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const supersedesId = String(req.params.id ?? "");
      const { id } = res.locals.body as { id: string };
      const result = await createCorrection(admin, orgId, supersedesId, id, req.auth!.userId);
      if ("code" in result) {
        const status = result.code === "not_found" ? 404 : result.code === "not_final" ? 409 : 500;
        res.status(status).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.inspection_correction_started",
        entity: "vehicle_inspections",
        entityId: result.id,
        meta: { supersedes: supersedesId },
      });
      res.status(201).json({ ok: true, id: result.id });
    }),
  );

  /** Discard a draft. A completed inspection is a record and is refused by name. */
  router.delete(
    "/:id",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const result = await discardDraft(admin, orgId, id);
      if ("code" in result) {
        const status = result.code === "not_found" ? 404 : result.code === "already_final" ? 409 : 500;
        res.status(status).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.inspection_discarded",
        entity: "vehicle_inspections",
        entityId: id,
        meta: {},
      });
      res.json({ ok: true });
    }),
  );

  /**
   * Destroy a report and everything it created (D-AVI29) — a SEPARATE verb from the discard above.
   *
   * ── WHY NOT A FLAG ON `DELETE /:id` ────────────────────────────────────────────────────────────
   * "Throw away a draft nobody has certified" and "destroy a §396.21 record" are different acts with
   * different consequences, and a `?force=true` on one route is how the second gets done by somebody
   * who meant the first. Two routes, two role gates, and the destructive one has to be asked for by
   * name.
   *
   * `requireRole("admin")` rather than `canManage`: a technician certifies inspections, they do not
   * destroy the record of one. The reason is validated by the contract before this handler runs, and
   * `deleteInspectionRecord` writes the audit row itself — BEFORE it deletes anything — because an
   * audit written here would only describe the deletes that succeeded.
   */
  router.post(
    "/:id/delete-record",
    requireOrg,
    requireRole("admin"),
    validateBody(inspectionDeleteRequestSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = res.locals.body as InspectionDeleteRequest;
      const result = await deleteInspectionRecord(admin, req.auth!.orgId!, String(req.params.id ?? ""), {
        reason: body.reason,
        actorId: req.auth!.userId,
      });
      if ("code" in result) {
        const status = result.code === "not_found" ? 404 : result.code === "reason_required" ? 400 : 500;
        res.status(status).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
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
  "catalogue_changed",
]);
