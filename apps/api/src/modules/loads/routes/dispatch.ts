import { Router, type Request, type Response } from "express";
import {
  deliveredWindowQuerySchema,
  dispatchLoadRequestSchema,
  loadSearchQuerySchema,
  resolveExceptionRequestSchema,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { assignmentHistoryQuerySchema } from "@silvicom/shared";
import { listAssignmentHistory } from "../dispatchLoads/history.js";
import { loadsHistoryFrom } from "../dispatchLoads/deliveredWindow.js";
import { listLoadActivity } from "../dispatchLoads/activity.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  getLoadDetail,
  listExceptions,
  resolveException,
  listEvents,
  listLoads,
  searchLoads,
  type DispatchResult,
} from "../dispatchLoads.js";
import { dispatchLoad, previewLoadDispatch } from "../dispatchToDriver.js";
import { readTrailersOnLoads } from "../liveLoadReads.js";

/**
 * Dispatch endpoints (Phase 3D, D49; cut down to reads and Dispatch by LOADS-MIRROR-PLAN.md LR6).
 *
 * ── WHAT IS NO LONGER HERE, AND WHY ──────────────────────────────────────────────────────────────
 * This router used to be the operator side of D45's approval gate: create and edit a load, reassign
 * it, submit → approve → release it, send it back, cancel it, and approve or release in bulk. Every
 * load is now McLeod's, projected onto `loads` on each sync (D-LMR2), so each of those writes either
 * fought the next sync (edit, reassign, cancel — McLeod's `V` already projects to canceled) or
 * approved something nobody needs to approve (D-LMR5: a load reaches a driver when the office
 * DISPATCHES it). Manual loads went with them (Q-LMR7): production had none. Unknown paths answer 404
 * like any other; `dispatchRoutes.test.ts` pins that each retired one does.
 *
 * What remains: the reads, the exceptions a driver's decline or a timed-out shift still raise, the
 * assignment history, and Dispatch itself.
 *
 * The assignments board went next (DISPATCH-BOARD-PLAN.md Q-DB10, ruled (b) 2026-10-16): its list
 * had had no screen since the Dispatch board replaced the Assignments page (#1426), and its one write,
 * End shift on a driver's stuck in-app shift, had never had a shift to end — production has opened no
 * duty session. The 16-hour sweeper still closes any that is left open.
 *
 * Authorization reuses the existing section matrix (`packages/shared/src/auth.ts`): `dispatch:manage`
 * is already granted to admin / fleet_manager / dispatcher, and `auditor` gets `dispatch:view`. No
 * new roles, no new claims.
 */
export function dispatchRouter(): Router {
  const router = Router();
  // Layer 2 of the entitlement gate (D55). Every dispatch route is behind it, so a tenant without the
  // module gets one clear 403 instead of an empty board they cannot explain.
  router.use(requireAuth, requireOrg, requireModule("dispatch"));

  const canView = requireSection("dispatch", "view");
  const canManage = requireSection("dispatch");

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
      // D-LA6: the Loads page bounds delivered loads by delivery time; without the pair, every load.
      const q = deliveredWindowQuerySchema.safeParse(req.query);
      if (!q.success) {
        res.status(400).json(apiError("invalid_request", q.error.issues[0]?.message ?? "invalid window"));
        return;
      }
      const { delivered_from: from, delivered_before: before } = q.data;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const [loads, history_from] = await Promise.all([
        listLoads(admin, req.auth!.orgId!, from && before ? { from, before } : undefined),
        loadsHistoryFrom(admin, req.auth!.orgId!),
      ]);
      res.json({ loads, history_from });
    }),
  );

  /**
   * Loads by number for the ⌘K palette (SIDEBAR-REDESIGN-PLAN.md D-SB8). Registered before
   * `/loads/:id`, which would otherwise read "search" as a load id and answer 404. The same gate as
   * the list: whoever may open the Loads page may find a load on it, and nobody else.
   */
  router.get(
    "/loads/search",
    canView,
    asyncHandler(async (req, res) => {
      const q = loadSearchQuerySchema.safeParse(req.query);
      if (!q.success) {
        res.status(400).json(apiError("invalid_request", q.error.issues[0]?.message ?? "invalid search"));
        return;
      }
      const loads = await searchLoads(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, q.data.q);
      res.json({ loads });
    }),
  );

  /**
   * Who has gone how long without a load, per active driver and per truck (LOADS-ACTIVITY-PLAN D-LA7).
   * A read, so no audit; the same gate as the Loads list it sits beside.
   */
  router.get(
    "/activity",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await listLoadActivity(admin, req.auth!.orgId!, new Date()));
    }),
  );

  /**
   * One load, with its stops, the photos captured at each of them, the full event timeline and every
   * lifecycle timestamp. This is what makes a real detail PAGE possible: until it existed the only
   * way to show one load was to fetch the whole board and `.find()` through it, so `/loads/:id` could
   * never survive a refresh or a deep link (LD1 / D-LD2).
   */
  router.get(
    "/loads/:id",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const load = await getLoadDetail(admin, req.auth!.orgId!, param(req, "id"));
      if (!load) {
        res.status(404).json(apiError("not_found", "That load no longer exists"));
        return;
      }
      // Photo URLs are signed for five minutes; caching the envelope would outlive them.
      res.setHeader("Cache-Control", "no-store");
      res.json({ load });
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

  /**
   * Which trailer each truck's current load carries (TRAILER-LINK-PLAN TL4): the McLeod column of the
   * Trailers page, beside the GPS pairing. Gated as the Trailers page is (`equipment: view`), not on
   * `dispatch`, since the page's readers are the shop and the fleet manager. A read, so no audit.
   */
  router.get(
    "/trailers-on-loads",
    requireSection("equipment", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ trailers: await readTrailersOnLoads(admin, req.auth!.orgId!) });
    }),
  );

  /**
   * Everything on the board that needs a person (L2 / D-L2). Event-driven, so a new event kind shows
   * up here rather than being excluded by a filter nobody widened — the failure of the client-side
   * `isException()` this replaces, which could only ever see two of the five sources.
   */
  router.get(
    "/exceptions",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ exceptions: await listExceptions(admin, req.auth!.orgId!) });
    }),
  );

  /** Closing an exception is itself an event — the log is append-only. */
  router.post(
    "/loads/:id/exceptions/resolve",
    canManage,
    validateBody(resolveExceptionRequestSchema),
    asyncHandler(async (req, res) => {
      const loadId = param(req, "id");
      await run(req, res, "dispatch.exception_resolved", loadId, () =>
        resolveException(
          getSupabaseAdmin(getAppLocals(req).env),
          req.auth!.orgId!,
          loadId,
          actorOf(req),
          res.locals.body as never,
        ),
      );
    }),
  );

  // ── Dispatch: the office sends a McLeod load to a driver (LR-D2; D-LMR5, D-LMR6) ────────────────
  // `canManage` is the section matrix's `dispatch:manage` — the same roles that could Release, which is
  // the act Dispatch replaces. The preview is `canManage` too: it exists only for the person about to
  // press Send, and it reads a driver's name against a load the viewer may not act on otherwise.
  router.get(
    "/loads/:id/dispatch-preview",
    canManage,
    asyncHandler(async (req, res) => {
      const parsed = dispatchLoadRequestSchema.safeParse({ driverId: req.query.driverId });
      if (!parsed.success) {
        res.status(400).json(apiError("bad_query", "driverId must be a driver id"));
        return;
      }
      const { env } = getAppLocals(req);
      const result = await previewLoadDispatch(
        getSupabaseAdmin(env),
        env,
        req.auth!.orgId!,
        param(req, "id"),
        parsed.data.driverId,
      );
      if (!result.ok) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      res.json({ preview: result.data });
    }),
  );

  router.post(
    "/loads/:id/dispatch",
    canManage,
    validateBody(dispatchLoadRequestSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as ReturnType<typeof dispatchLoadRequestSchema.parse>;
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const loadId = param(req, "id");
      const result = await dispatchLoad(admin, env, req.auth!.orgId!, req.auth!.userId, loadId, body.driverId);
      if (!result.ok) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: "dispatch.load_dispatched",
        entity: "loads",
        entityId: loadId,
        meta: {
          dispatchId: result.data.id,
          driverId: result.data.driverId,
          channel: result.data.channel,
          outcome: result.data.outcome,
          outcomeReason: result.data.outcomeReason,
        },
      });
      res.status(201).json({ dispatch: result.data });
    }),
  );

  /** The attribution trail (L5 / D-L6) — segments per driver / vehicle / trailer over a date range. */
  router.get(
    "/assignments/history",
    canView,
    asyncHandler(async (req, res) => {
      const parsed = assignmentHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_query", parsed.error.message));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listAssignmentHistory(admin, req.auth!.orgId!, parsed.data);
      res.json({ segments: result.rows, nextCursor: result.nextCursor });
    }),
  );

  return router;
}
