import { Router } from "express";
import { z } from "zod";
import { inspectorQualificationBasisSchema, rolesThatCanView, rolesThatManage } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { createInspector, listInspectors, setInspectorPeriod, type InspectorInput } from "../inspections/inspectors.js";

/**
 * `/api/maintenance/inspectors` — the §396.19 register (plan step A4, D-AVI6).
 *
 * Writing a row here is asserting that a named person meets a federal qualification standard, so it
 * is audited like the certifications it will underwrite.
 */

const createSchema = z.object({
  fullName: z.string().min(1).max(200),
  address: z.string().max(400).nullish(),
  userId: z.uuid().nullish(),
  qualificationBasis: inspectorQualificationBasisSchema,
  brakeQualified: z.boolean(),
  evidenceDocumentId: z.uuid().nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().max(2000).nullish(),
});

const periodSchema = z.object({
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const listSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeRetired: z.coerce.boolean().optional(),
});

export function inspectorsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requireOrg,
    requireRole(...rolesThatCanView("maintenance")),
    asyncHandler(async (req, res) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listInspectors(admin, req.auth!.orgId!, {
        asOf: parsed.data.asOf ?? new Date().toISOString().slice(0, 10),
        includeRetired: parsed.data.includeRetired,
      });
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, inspectors: result });
    }),
  );

  router.post(
    "/",
    requireOrg,
    requireRole(...rolesThatManage("maintenance")),
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as InspectorInput;
      const result = await createInspector(admin, orgId, req.auth!.userId, body);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.inspector_registered",
        entity: "maintenance_inspectors",
        entityId: result.id,
        meta: {
          fullName: body.fullName,
          qualificationBasis: body.qualificationBasis,
          brakeQualified: body.brakeQualified,
          effectiveFrom: body.effectiveFrom,
        },
      });
      res.status(201).json({ ok: true, id: result.id });
    }),
  );

  /**
   * Retire an inspector (`effectiveTo` a date) or bring one back (`null`).
   *
   * Not a delete: 0280's `on delete restrict` forbids removing anybody who has signed a report, and
   * that is the point — a report must name who performed it, and the qualification evidence outlives
   * the employment by a year.
   */
  router.patch(
    "/:id",
    requireOrg,
    requireRole(...rolesThatManage("maintenance")),
    validateBody(periodSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { effectiveTo } = res.locals.body as { effectiveTo: string | null };
      const result = await setInspectorPeriod(admin, orgId, id, effectiveTo);
      if ("code" in result) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: effectiveTo ? "maintenance.inspector_retired" : "maintenance.inspector_reinstated",
        entity: "maintenance_inspectors",
        entityId: id,
        meta: { effectiveTo },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
