import { Router, type Request, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acceptLoadRequestSchema,
  acceptanceCopy,
  changeEquipmentRequestSchema,
  completeStopRequestSchema,
  declineLoadRequestSchema,
  endShiftRequestSchema,
  startLoadRequestSchema,
  startShiftRequestSchema,
} from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import {
  changeEquipment,
  endShift,
  getActiveSession,
  getEquipmentPickList,
  resolveDriverId,
  startShift,
  type DutyResult,
} from "../services/dutySessions.js";
import {
  acceptLoad,
  completeStop,
  declineLoad,
  getDriverLoads,
  getDriverType,
  startLoad,
  type LoadResult,
} from "../services/driverLoads.js";

/**
 * Driver self-service endpoints (Driver App, Phases 1 + 3A). Identity is ALWAYS resolved server-side
 * from the verified JWT (req.auth) — never from the request body. RLS (0084/0086) is the real
 * boundary; these endpoints add server logic + audit on top.
 */
export function meRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** Every driver route below needs the caller's roster driver row; 404 when no login is linked (D3). */
  const driverOnly = [requireOrg, requireRole("driver")] as const;

  /** Express 5 types a path param as `string | string[]`; every route here declares exactly one. */
  const pathParam = (req: Request, name: string): string => {
    const v = req.params[name];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };

  // The signed-in driver's own context: their driver record + assigned vehicle(s). Bootstrap call.
  router.get(
    "/driver",
    ...driverOnly,
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

  // ── Duty sessions (Phase 3A — D43/D44) ──────────────────────────────────────
  // A driver's equipment is a time-ranged fact they assert, not a static admin column. These four
  // endpoints are the only write path: the DB grants drivers no write policy at all (0086), so a
  // driver hitting PostgREST directly can read their own duty history and change nothing.

  /**
   * The check-in pick list. Served with the service role and a minimal projection precisely so RLS
   * can stay closed on `vehicles`/`trailers` — a driver picks a truck without being handed the
   * fleet's odometers, capacities or cost basis.
   */
  router.get(
    "/equipment",
    ...driverOnly,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = await resolveDriverId(admin, orgId, req.auth!.userId);
      if (!driverId) {
        res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
        return;
      }
      res.json(await getEquipmentPickList(admin, orgId, driverId));
    }),
  );

  /** The caller's active shift + its equipment segments, or `{ session: null }` when off duty. */
  router.get(
    "/shift",
    ...driverOnly,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = await resolveDriverId(admin, orgId, req.auth!.userId);
      if (!driverId) {
        res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
        return;
      }
      res.json({ session: await getActiveSession(admin, orgId, driverId) });
    }),
  );

  /**
   * Shared tail for the three shift mutations: resolve the driver, run the operation, translate a
   * conflict into its 409 envelope, and audit the result. The conflict body carries who holds the
   * unit and since when, because the app must show that before offering `take_over` (D44.6).
   */
  const runShiftMutation = async (
    req: Request,
    res: Response,
    action: string,
    op: (admin: SupabaseClient, orgId: string, driverId: string) => Promise<DutyResult>,
  ): Promise<void> => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const orgId = req.auth!.orgId!;
    const driverId = await resolveDriverId(admin, orgId, req.auth!.userId);
    if (!driverId) {
      res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
      return;
    }

    const result = await op(admin, orgId, driverId);
    if (!result.ok) {
      res
        .status(result.status)
        .json({ ...apiError(result.code, result.message), ...(result.conflict ? { conflict: result.conflict } : {}) });
      return;
    }

    await writeAudit(admin, {
      orgId,
      actorId: req.auth!.userId,
      action,
      entity: "driver_duty_sessions",
      entityId: result.session?.id,
      meta: { driver_id: driverId },
    });
    res.json({ session: result.session });
  };

  /** Start the day: truck required, trailer optional ("bobtail / not hooked yet" is first-class). */
  router.post(
    "/shift/start",
    ...driverOnly,
    validateBody(startShiftRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof startShiftRequestSchema.parse>;
      await runShiftMutation(req, res, "duty.shift_started", (admin, orgId, driverId) =>
        startShift(admin, orgId, driverId, body),
      );
    }),
  );

  /** Drop-and-hook / truck swap. Opens a new segment; deliberately does NOT end the shift. */
  router.post(
    "/shift/equipment",
    ...driverOnly,
    validateBody(changeEquipmentRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof changeEquipmentRequestSchema.parse>;
      await runShiftMutation(req, res, "duty.equipment_changed", (admin, orgId, driverId) =>
        changeEquipment(admin, orgId, driverId, body),
      );
    }),
  );

  /** Sign off. Idempotent, so an offline end-of-day that drains twice is a no-op rather than an error. */
  router.post(
    "/shift/end",
    ...driverOnly,
    validateBody(endShiftRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof endShiftRequestSchema.parse>;
      await runShiftMutation(req, res, "duty.shift_ended", (admin, orgId, driverId) =>
        endShift(admin, orgId, driverId, body),
      );
    }),
  );

  // ── Loads (Phase 3B — D45/D46/D47) ──────────────────────────────────────────
  // A driver only ever sees loads dispatch approved AND released. That gate is the RLS predicate in
  // 0087; it is repeated in the query here so the service-role read never becomes the one path that
  // leaks an unapproved load. Every transition is its own endpoint — there is no `PATCH status`.

  /** Everything the driver may see, stops + photos nested, plus the D46 acceptance copy. */
  router.get(
    "/loads",
    ...driverOnly,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = await resolveDriverId(admin, orgId, req.auth!.userId);
      if (!driverId) {
        res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
        return;
      }
      const [loads, driverType] = await Promise.all([
        getDriverLoads(admin, orgId, driverId),
        getDriverType(admin, orgId, driverId),
      ]);
      res.json({ loads, driver_type: driverType, acceptance: acceptanceCopy(driverType) });
    }),
  );

  /** Shared tail for the four load transitions: resolve the driver, run it, audit, return fresh state. */
  const runLoadMutation = async (
    req: Request,
    res: Response,
    action: string,
    op: (admin: SupabaseClient, orgId: string, driverId: string) => Promise<LoadResult>,
  ): Promise<void> => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const orgId = req.auth!.orgId!;
    const driverId = await resolveDriverId(admin, orgId, req.auth!.userId);
    if (!driverId) {
      res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
      return;
    }

    const result = await op(admin, orgId, driverId);
    if (!result.ok) {
      res
        .status(result.status)
        .json({ ...apiError(result.code, result.message), ...(result.detail ? { detail: result.detail } : {}) });
      return;
    }

    await writeAudit(admin, {
      orgId,
      actorId: req.auth!.userId,
      action,
      entity: "loads",
      entityId: pathParam(req, "id"),
      meta: { driver_id: driverId },
    });
    res.json({ load: result.load });
  };

  /** Accept / acknowledge — stamps the duty session and flags any equipment mismatch (D47). */
  router.post(
    "/loads/:id/accept",
    ...driverOnly,
    validateBody(acceptLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof acceptLoadRequestSchema.parse>;
      await runLoadMutation(req, res, "load.accepted", (admin, orgId, driverId) =>
        acceptLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
      );
    }),
  );

  /** Decline — returns the load to dispatch for an owner-operator, raises an exception otherwise. */
  router.post(
    "/loads/:id/decline",
    ...driverOnly,
    validateBody(declineLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof declineLoadRequestSchema.parse>;
      await runLoadMutation(req, res, "load.declined", (admin, orgId, driverId) =>
        declineLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
      );
    }),
  );

  /** Explicit "rolling" — the first worked stop does this implicitly as well. */
  router.post(
    "/loads/:id/start",
    ...driverOnly,
    validateBody(startLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof startLoadRequestSchema.parse>;
      await runLoadMutation(req, res, "load.started", (admin, orgId, driverId) =>
        startLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
      );
    }),
  );

  /** Advance a stop + record its already-uploaded photos. Idempotent on the client photo UUIDs. */
  router.post(
    "/loads/:id/stops/:stopId",
    ...driverOnly,
    validateBody(completeStopRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof completeStopRequestSchema.parse>;
      await runLoadMutation(req, res, "load.stop_recorded", (admin, orgId, driverId) =>
        completeStop(admin, orgId, driverId, pathParam(req, "id"), pathParam(req, "stopId"), req.auth!.userId, body),
      );
    }),
  );

  // In-app account deletion (Apple 5.1.1(v) + Google — plan CG1/D26). Deletes the login + identity
  // (auth user, membership, driver link). Fuel records are retained per employer recordkeeping.
  router.post(
    "/delete-account",
    ...driverOnly,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = req.auth!.userId;

      // Close any open shift first, so the truck they were in is released for the next driver
      // instead of staying locked by the exclusive-equipment index (0086).
      const driverId = await resolveDriverId(admin, orgId, userId);
      if (driverId) {
        await admin.rpc("end_duty_session", {
          p_org: orgId,
          p_driver: driverId,
          p_ended_at: null,
          p_odometer: null,
          p_reason: "dispatch",
        });
      }

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
