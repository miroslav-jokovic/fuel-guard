import type { Router } from "express";
import { z } from "zod";
import { requireRole, requireOrg } from "../../middleware/auth.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { planFuelRoute, type PlanRequest } from "../../services/fuelPlanning.js";
import { saveFuelPlanHistory } from "../../services/fuelPlanHistory.js";

// Validate + bound the plan request (security: reject malformed/oversized input before any Samsara/HERE work).
const planPointSchema = z.object({ lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), text: z.string().max(300).nullable().optional() });
const planBodySchema = z.object({
  vehicleId: z.string().min(1).max(64),
  origin: planPointSchema,
  destination: planPointSchema,
  waypoints: z.array(planPointSchema).max(12).optional(),
  loadGrossLb: z.number().min(0).max(200000).nullable().optional(),
  equipmentType: z.string().max(32).nullable().optional(),
  hazmat: z.array(z.string().max(32)).max(11).optional(),
  tunnelCategory: z.string().max(4).nullable().optional(),
  avoidTunnels: z.boolean().nullable().optional(),
  originLabel: z.string().max(300).nullable().optional(),
  destinationLabel: z.string().max(300).nullable().optional(),
  manualFuelPct: z.number().min(0).max(100).nullable().optional(),
  manualHos: z.object({
    driveHours: z.number().min(0).max(24).nullable().optional(),
    breakHours: z.number().min(0).max(24).nullable().optional(),
    shiftHours: z.number().min(0).max(24).nullable().optional(),
    cycleHours: z.number().min(0).max(120).nullable().optional(),
  }).nullable().optional(),
});

/** Fuel-plan generation + saved-plan history routes. */
export function registerPlanRoutes(router: Router): void {
  // On-demand smart-fuel plan for one truck + route. Read-only (no Samsara write-back).
  router.post(
    "/plan",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const parsed = planBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid plan request"));
        return;
      }
      const result = await planFuelRoute(admin, env, orgId, parsed.data as PlanRequest);
      // Save to history (best-effort — never fail the plan response on a history write).
      try { await saveFuelPlanHistory(admin, orgId, req.auth!.userId ?? null, parsed.data as PlanRequest, result); } catch { /* ignore */ }
      res.json(result);
    }),
  );
  // Planned-route history — the plans this org has generated, newest first, with the creator + summary data.
  router.get(
    "/plans",
    requireOrg,
    requireRole("admin", "fleet_manager", "auditor", "dispatcher"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data } = await admin.from("fuel_plans")
        .select("id, created_at, created_by_label, unit_number, origin_label, destination_label, distance_miles, duration_hours, status, stop_count, total_gallons, total_cost, arrival_fuel_pct")
        .eq("org_id", orgId).order("created_at", { ascending: false }).limit(200);
      res.json({ plans: data ?? [] });
    }),
  );
  // Delete one saved plan from history. Org-scoped via the service-role client (auditor is read-only, so
  // deletion is limited to the roles that can generate plans). Idempotent — deleting a missing id is a no-op.
  router.delete(
    "/plans/:id",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      if (!id) {
        res.status(400).json(apiError("bad_request", "Missing plan id"));
        return;
      }
      const { error } = await admin.from("fuel_plans").delete().eq("org_id", orgId).eq("id", id);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not delete the plan"));
        return;
      }
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "fuel_plan.deleted", entity: "fuel_plans", entityId: id });
      res.json({ ok: true });
    }),
  );
  // Bulk-delete saved plans from history (multi-select). One org-scoped `in (...)` delete, capped to match the
  // history page size so a malformed/oversized body can't fan out into a huge statement.
  router.post(
    "/plans/delete",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const parsed = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Expected { ids: string[] } with 1–200 ids"));
        return;
      }
      const ids = parsed.data.ids;
      const { error } = await admin.from("fuel_plans").delete().eq("org_id", orgId).in("id", ids);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not delete the selected plans"));
        return;
      }
      // Step 5.11: no entityId. A bulk delete has no single entity, and `ids.join(",")` is not a
      // uuid — it lost the whole audit row, so a bulk deletion of fuel plans left no trace at all.
      // The ids go in meta, which is the only place that can hold more than one of them.
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "fuel_plan.bulk_deleted", entity: "fuel_plans", meta: { count: ids.length, ids } });
      res.json({ ok: true, deleted: ids.length });
    }),
  );
}
