import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  assignLoadRequestSchema,
  createLoadRequestSchema,
  reasonRequestSchema,
  rolesThatCanView,
  rolesThatManage,
  updateLoadRequestSchema,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import {
  assignLoad,
  createLoad,
  endDutySession,
  listAssignments,
  listEvents,
  listLoads,
  bulkTransition,
  transitionLoad,
  updateLoad,
  type DispatchResult,
} from "../services/dispatchLoads.js";

/**
 * Dispatch endpoints (Phase 3D, D49) — the operator side of the approval gate.
 *
 * D45 made a load invisible to a driver until a human approves and releases it. That is only a
 * control if a human can actually do it, which before this router meant hand-editing
 * `supabase/_deploy/seed_driver_load.sql` in the SQL editor. These routes are what make the gate real.
 *
 * Authorization reuses the existing section matrix (`packages/shared/src/auth.ts`): `dispatch:manage`
 * is already granted to admin / fleet_manager / dispatcher, and `auditor` gets `dispatch:view`. No
 * new roles, no new claims.
 */
export function dispatchRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);

  const canView = requireRole(...rolesThatCanView("dispatch"));
  const canManage = requireRole(...rolesThatManage("dispatch"));

  const actorOf = (req: Request) => ({ userId: req.auth!.userId, role: req.auth!.role });
  const param = (req: Request, name: string): string => {
    const v = req.params[name];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };

  /** Shared tail: run it, translate a blocked transition, audit, respond. */
  const run = async <T>(
    req: Request,
    res: Response,
    action: string,
    loadId: string,
    op: () => Promise<DispatchResult<T>>,
  ): Promise<void> => {
    const result = await op();
    if (!result.ok) {
      res
        .status(result.status)
        .json({ ...apiError(result.code, result.message), ...(result.detail ? { detail: result.detail } : {}) });
      return;
    }
    await writeAudit(getSupabaseAdmin(getAppLocals(req).env), {
      orgId: req.auth!.orgId!,
      actorId: req.auth!.userId,
      action,
      entity: "loads",
      entityId: loadId,
    });
    res.json(result.data);
  };

  // ── reads ───────────────────────────────────────────────────────────────────
  router.get(
    "/loads",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ loads: await listLoads(admin, req.auth!.orgId!) });
    }),
  );

  router.get(
    "/loads/:id/events",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ events: await listEvents(admin, req.auth!.orgId!, param(req, "id")) });
    }),
  );

  router.get(
    "/assignments",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ assignments: await listAssignments(admin, req.auth!.orgId!) });
    }),
  );

  // ── authoring ───────────────────────────────────────────────────────────────
  router.post(
    "/loads",
    canManage,
    validateBody(createLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof createLoadRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await createLoad(admin, req.auth!.orgId!, actorOf(req), body);
      if (!result.ok) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: "dispatch.load_created",
        entity: "loads",
        entityId: result.data.id,
      });
      res.status(201).json(result.data);
    }),
  );

  router.patch(
    "/loads/:id",
    canManage,
    validateBody(updateLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof updateLoadRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const id = param(req, "id");
      await run(req, res, "dispatch.load_updated", id, () =>
        updateLoad(admin, req.auth!.orgId!, id, body),
      );
    }),
  );

  router.post(
    "/loads/:id/assign",
    canManage,
    validateBody(assignLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof assignLoadRequestSchema.parse>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const id = param(req, "id");
      await run(req, res, "dispatch.load_assigned", id, () =>
        assignLoad(admin, req.auth!.orgId!, id, actorOf(req), body),
      );
    }),
  );

  // ── the lifecycle, one endpoint per transition (never a PATCH status) ────────
  for (const action of ["submit", "approve", "release"] as const) {
    router.post(
      `/loads/:id/${action}`,
      canManage,
      asyncHandler(async (req, res) => {
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const id = param(req, "id");
        await run(req, res, `dispatch.load_${action}ed`, id, () =>
          transitionLoad(admin, req.auth!.orgId!, id, actorOf(req), action),
        );
      }),
    );
  }

  // Rejecting and cancelling both demand a reason — these are the two a driver or an auditor asks
  // about later, and "no reason given" is not an answer anybody can work with.
  for (const action of ["reject", "cancel"] as const) {
    router.post(
      `/loads/:id/${action}`,
      canManage,
      validateBody(reasonRequestSchema),
      asyncHandler(async (req, res) => {
        const body = res.locals.body as ReturnType<typeof reasonRequestSchema.parse>;
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const id = param(req, "id");
        await run(req, res, `dispatch.load_${action}ed`, id, () =>
          transitionLoad(admin, req.auth!.orgId!, id, actorOf(req), action, body.reason),
        );
      }),
    );
  }

  /**
   * Bulk approve / release. Same gate per row; partial success is REPORTED, never swallowed (D49).
   */
  router.post(
    "/loads/bulk",
    canManage,
    validateBody(z.object({ ids: z.array(z.uuid()).min(1).max(200), action: z.enum(["approve", "release"]) })),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as { ids: string[]; action: "approve" | "release" };
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await bulkTransition(admin, req.auth!.orgId!, body.ids, actorOf(req), body.action);
      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: `dispatch.bulk_${body.action}`,
        entity: "loads",
        meta: { requested: body.ids.length, succeeded: result.succeeded, failed: result.failed },
      });
      res.json(result);
    }),
  );

  // ── the assignments board ───────────────────────────────────────────────────
  /** Close a shift a driver forgot to end, so their truck is selectable again (D44.5). */
  router.post(
    "/assignments/:driverId/end",
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const driverId = param(req, "driverId");
      await endDutySession(admin, req.auth!.orgId!, driverId);
      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: "dispatch.shift_ended",
        entity: "driver_duty_sessions",
        entityId: driverId,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
