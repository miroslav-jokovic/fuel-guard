import { Router, type Request, type Response } from "express";
import {
  HOME_TIME_PERMISSION,
  homeTimeChangeSchema,
  homeTimeEndSchema,
  homeTimeMarkSchema,
  isRecordId,
  type HomeTimeChange,
  type HomeTimeEnd,
  type HomeTimeMark,
  type HomeTimePeriod,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { requireNamedPermission } from "../../org/index.js";
import {
  cancelHomeTime,
  changeHomeTime,
  endHomeTime,
  isHomeTimeRefusal,
  listHomeTimeDrivers,
  listHomeTimes,
  markHomeTime,
  reopenHomeTime,
  type HomeTimeRefusal,
} from "./homeTime.js";

/**
 * `/api/roster/home-time` — the office marks a driver's home time (`docs/plans/dispatch-loads/
 * HOME-TIME-PLAN.md` §3.2, step HT2).
 *
 * ── WHO READS, WHO WRITES ────────────────────────────────────────────────────────────────────────
 * Reading is the dispatch board's gate, `dispatch: view` on a carrier entitled to Dispatch: whoever may
 * see where every truck is may see whose driver is home. Writing is the named permission
 * `roster.home_time` (D-HT7), asked in front of every write: the row is the roster's, a dispatcher holds
 * `roster: view` only, and `roster: manage` would hand over the whole roster to grant one act.
 *
 * ── EVERY WRITE IS AUDITED ───────────────────────────────────────────────────────────────────────
 * `home_time.marked | changed | ended | canceled | reopened`, naming the period, the driver and what
 * moved. The times ARE in the audit row: "who changed his return from Monday to Thursday" is the
 * question an overstay raises, and the row is the only record of the old value.
 */
export function rosterHomeTimeRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("dispatch"), requireSection("dispatch", "view"));
  const mayMark = requireNamedPermission(HOME_TIME_PERMISSION);

  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  const refuse = (res: Response, r: HomeTimeRefusal): void => {
    const status = r.code === "not_found" ? 404 : r.code === "invalid" ? 422 : r.code === "conflict" ? 409 : 500;
    res.status(status).json({ ...apiError(r.code, r.message), ...(r.code === "conflict" && r.existingId ? { existingId: r.existingId } : {}) });
  };
  /** The period id from the path, or a 404 written and null: a malformed id is not a Postgres cast error. */
  const periodId = (req: Request, res: Response): string | null => {
    const id = String(req.params.id ?? "").toLowerCase();
    if (isRecordId(id)) return id;
    res.status(404).json(apiError("not_found", "Home time not found"));
    return null;
  };
  const audit = (req: Request, action: string, period: HomeTimePeriod, meta: Record<string, unknown> = {}) =>
    writeAudit(adminOf(req), {
      orgId: req.auth!.orgId!,
      actorId: req.auth!.userId,
      action,
      entity: "driver_time_off",
      entityId: period.id,
      meta: { driverId: period.driverId, vehicleId: period.vehicleId, ...meta },
    });

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await listHomeTimes(adminOf(req), req.auth!.orgId!, new Date()));
    }),
  );

  router.get(
    "/drivers",
    asyncHandler(async (req, res) => {
      res.json({ drivers: await listHomeTimeDrivers(adminOf(req), req.auth!.orgId!) });
    }),
  );

  router.post(
    "/",
    mayMark,
    validateBody(homeTimeMarkSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as HomeTimeMark;
      const out = await markHomeTime(adminOf(req), req.auth!.orgId!, req.auth!.userId, body, new Date());
      if (isHomeTimeRefusal(out)) return refuse(res, out);
      await audit(req, "home_time.marked", out, { startAt: out.startAt, expectedReturnAt: out.expectedReturnAt, disposition: out.disposition });
      res.status(201).json({ period: out });
    }),
  );

  router.patch(
    "/:id",
    mayMark,
    validateBody(homeTimeChangeSchema),
    asyncHandler(async (req, res) => {
      const id = periodId(req, res);
      if (!id) return;
      const out = await changeHomeTime(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, res.locals.body as HomeTimeChange, new Date());
      if (isHomeTimeRefusal(out)) return refuse(res, out);
      // A change that moved nothing is not an event; the audit log records what happened.
      if (Object.keys(out.changed).length > 0) await audit(req, "home_time.changed", out.period, { changed: out.changed });
      res.json({ period: out.period });
    }),
  );

  router.post(
    "/:id/end",
    mayMark,
    validateBody(homeTimeEndSchema),
    asyncHandler(async (req, res) => {
      const id = periodId(req, res);
      if (!id) return;
      const now = new Date();
      const { endAt } = res.locals.body as HomeTimeEnd;
      const out = await endHomeTime(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, "returned", endAt ? new Date(endAt) : now, now);
      if (isHomeTimeRefusal(out)) return refuse(res, out);
      await audit(req, "home_time.ended", out, { endAt: out.endAt, reason: out.endReason, expectedReturnAt: out.expectedReturnAt });
      res.json({ period: out });
    }),
  );

  router.post(
    "/:id/cancel",
    mayMark,
    asyncHandler(async (req, res) => {
      const id = periodId(req, res);
      if (!id) return;
      const out = await cancelHomeTime(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, new Date());
      if (isHomeTimeRefusal(out)) return refuse(res, out);
      await audit(req, "home_time.canceled", out, { startAt: out.startAt, expectedReturnAt: out.expectedReturnAt });
      res.json({ period: out });
    }),
  );

  router.post(
    "/:id/reopen",
    mayMark,
    asyncHandler(async (req, res) => {
      const id = periodId(req, res);
      if (!id) return;
      const out = await reopenHomeTime(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, new Date());
      if (isHomeTimeRefusal(out)) return refuse(res, out);
      await audit(req, "home_time.reopened", out, { expectedReturnAt: out.expectedReturnAt });
      res.json({ period: out });
    }),
  );

  return router;
}
