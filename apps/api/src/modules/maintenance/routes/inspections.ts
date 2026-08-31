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

  return router;
}
