import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

/**
 * Driver self-service endpoints (Driver App, Phase 1). Identity is ALWAYS resolved server-side from
 * the verified JWT (req.auth) — never from the request body. RLS (0084) is the real boundary; these
 * endpoints add server logic + audit on top.
 */
export function meRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // The signed-in driver's own context: their driver record + assigned vehicle(s). Bootstrap call.
  router.get(
    "/driver",
    requireOrg,
    requireRole("driver"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;

      const { data: driver } = await admin
        .from("drivers")
        .select("id, full_name, status, employee_id, phone")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!driver) {
        res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
        return;
      }

      const { data: vehicles } = await admin
        .from("vehicles")
        .select("id, unit_number, make, model, fuel_type, tank_capacity_gal, current_odometer")
        .eq("org_id", orgId)
        .eq("assigned_driver_id", driver.id)
        .order("unit_number", { ascending: true });

      res.json({ driver, vehicles: vehicles ?? [] });
    }),
  );

  // In-app account deletion (Apple 5.1.1(v) + Google — plan CG1/D26). Deletes the login + identity
  // (auth user, membership, driver link). Fuel records are retained per employer recordkeeping.
  router.post(
    "/delete-account",
    requireOrg,
    requireRole("driver"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;

      await admin.from("drivers").update({ user_id: null }).eq("org_id", orgId).eq("user_id", userId);
      await admin.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
      await writeAudit(admin, {
        orgId,
        actorId: userId,
        action: "account.deleted",
        entity: "auth.users",
        entityId: userId,
      });

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        res.status(500).json(apiError("delete_failed", "Could not delete the account"));
        return;
      }
      res.json({ ok: true });
    }),
  );

  return router;
}
