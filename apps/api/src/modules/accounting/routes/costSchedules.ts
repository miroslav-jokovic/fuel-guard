import type { Router } from "express";
import { z } from "zod";
import { rolesThatCanView, rolesThatManage, truckCostScheduleSchema } from "@silvicom/shared";
import { requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from "../../financial/index.js";

/**
 * The truck fixed-cost schedule (T1, TRUCK-COST-ATTRIBUTION-PLAN) — the office's contract
 * knowledge, maintained from a page because the alternative is SQL by hand against a deny-all
 * table. Writes gate on the accounting MANAGE set (admin + accountant) and every one is audited:
 * these rows charge dollars onto trucks in the CPM report, so who changed what is part of the
 * report's auditability, not bookkeeping about bookkeeping.
 */
export function registerCostScheduleRoutes(router: Router): void {
  const canView = requireRole(...rolesThatCanView("accounting"));
  const canManage = requireRole(...rolesThatManage("accounting"));

  router.get(
    "/cost-schedules",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, schedules: await listSchedules(admin, req.auth!.orgId!) });
    }),
  );

  router.post(
    "/cost-schedules",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const parsed = truckCostScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid schedule row"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const row = await createSchedule(admin, orgId, parsed.data);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "accounting.cost_schedule.created",
        entity: "truck_cost_schedules",
        meta: { id: row.id, unit: row.unit_number, category: row.category, monthly_amount: row.monthly_amount },
      });
      res.json({ ok: true, schedule: row });
    }),
  );

  router.patch(
    "/cost-schedules/:id",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const id = z.string().uuid().safeParse(req.params.id);
      const parsed = truckCostScheduleSchema.partial().safeParse(req.body);
      if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) {
        res.status(400).json(apiError("bad_request", "Provide a schedule id and at least one valid field."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const row = await updateSchedule(admin, orgId, id.data, parsed.data);
      if (!row) {
        res.status(404).json(apiError("not_found", "No such schedule row in this organization."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "accounting.cost_schedule.updated",
        entity: "truck_cost_schedules",
        meta: { id: row.id, patch: parsed.data },
      });
      res.json({ ok: true, schedule: row });
    }),
  );

  router.delete(
    "/cost-schedules/:id",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json(apiError("bad_request", "Provide a schedule id."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const removed = await deleteSchedule(admin, orgId, id.data);
      if (!removed) {
        res.status(404).json(apiError("not_found", "No such schedule row in this organization."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "accounting.cost_schedule.deleted",
        entity: "truck_cost_schedules",
        meta: { id: id.data },
      });
      res.json({ ok: true });
    }),
  );
}
