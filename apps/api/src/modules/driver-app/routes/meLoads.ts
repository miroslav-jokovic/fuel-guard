import { Router, type Request, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import {
  acceptLoadRequestSchema,
  acceptanceCopy,
  acknowledgeLoadRequestSchema,
  addStopPhotosRequestSchema,
  completeStopRequestSchema,
  declineLoadRequestSchema,
  startLoadRequestSchema,
} from "@silvicom/shared";
import { requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { resolveDriverId } from "../dutySessions.js";
import {
  acceptLoad,
  acknowledgeLoad,
  addStopPhotos,
  completeStop,
  declineLoad,
  getDriverLoads,
  getDriverType,
  startLoad,
  type LoadResult,
} from "../../loads/index.js";

/**
 * The driver's load routes under `/api/me` (Phase 3B — D45/D46/D47; T1 N-9). Moved out of `me.ts` at
 * N-9, which was over the 450-line warning before "Got it" was added. `meRouter` mounts this after its
 * own `requireAuth` and per-driver write limit, so both still apply to every route here.
 *
 * A driver sees a manual load once dispatch approved and released it (0087), and a McLeod load once
 * the office SENT it (D-LMR5, 0655/0661). Both rules are the database's, asked by the read rather than
 * restated. Every transition is its own endpoint — there is no `PATCH status`.
 *
 * ── EVERY REFUSAL CARRIES A CODE (D-MK21) ────────────────────────────────────────────────────────
 * The outbox decides retry, park or done from the status AND the code: a 409 `wrong_state` is parked
 * for the driver, a 5xx or a dropped connection is retried forever. So every refusal here is
 * `apiError(code, message)` — the `{ error: { code, message } }` envelope the app already reads
 * (`apps/driver/src/lib/api.ts`) — and a thrown error reaches `errorResponder`, whose 500 carries
 * `internal_error`. A 200 is always `{ load, status }` (`loadActionResponseSchema`); late evidence is
 * a 200 with `status: "late_evidence"`, never a 4xx (D-MK20).
 */
const acknowledgeBody = acknowledgeLoadRequestSchema.partial({ action_id: true });

export function meLoadsRouter(): Router {
  const router = Router();
  const driverOnly = [requireOrg, requireRole("driver")] as const;

  const noDriver = (res: Response) =>
    res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));

  /** Everything the driver may see, stops + photos nested, plus the D46 acceptance copy. */
  router.get(
    "/loads",
    ...driverOnly,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = await resolveDriverId(admin, orgId, req.auth!.userId);
      if (!driverId) {
        noDriver(res);
        return;
      }
      const [loads, driverType] = await Promise.all([
        getDriverLoads(admin, orgId, driverId),
        getDriverType(admin, orgId, driverId),
      ]);
      res.json({ loads, driver_type: driverType, acceptance: acceptanceCopy(driverType) });
    }),
  );

  /** Shared tail for every load action: resolve the driver, run it, audit, return fresh state. */
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
      noDriver(res);
      return;
    }

    const result = await op(admin, orgId, driverId);
    if (!result.ok) {
      res
        .status(result.status)
        .json({ ...apiError(result.code, result.message), ...(result.detail ? { detail: result.detail } : {}) });
      return;
    }

    // Audited on a replay too, with what the function answered: "the phone sent it again" is worth
    // having on the record when somebody reconstructs a driver's day.
    await writeAudit(admin, {
      orgId,
      actorId: req.auth!.userId,
      action,
      entity: "loads",
      entityId: pathParam(req, "id"),
      meta: { driver_id: driverId, status: result.status },
    });
    res.json({ load: result.load, status: result.status });
  };

  /** Registers one action route: validate the body, then run the op through the shared tail. */
  const action = <T>(
    path: string,
    schema: ZodType<T>,
    audit: string,
    op: (admin: SupabaseClient, orgId: string, driverId: string, req: Request, body: T) => Promise<LoadResult>,
  ) =>
    router.post(
      path,
      ...driverOnly,
      validateBody(schema),
      asyncHandler(async (req, res) => {
        const body = res.locals.body as T;
        await runLoadMutation(req, res, audit, (admin, orgId, driverId) => op(admin, orgId, driverId, req, body));
      }),
    );

  // Accept — stamps the duty session and flags any equipment mismatch (D47). Manual loads only (DL014).
  action("/loads/:id/accept", acceptLoadRequestSchema, "load.accepted", (admin, orgId, driverId, req, body) =>
    acceptLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
  );

  // Decline — returns the load to dispatch for an owner-operator, raises an exception otherwise.
  action("/loads/:id/decline", declineLoadRequestSchema, "load.declined", (admin, orgId, driverId, req, body) =>
    declineLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
  );

  // Explicit "rolling" — the first worked stop does this implicitly as well. Manual loads only (DL013).
  action("/loads/:id/start", startLoadRequestSchema, "load.started", (admin, orgId, driverId, req, body) =>
    startLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
  );

  // "Got it" on a McLeod load the office sent (DF-2). The office sees "Seen by driver" on the dispatch.
  // The body is validated with the action id OPTIONAL on purpose: its absence is refused by the function
  // itself (DL015 → 422 action_id_required), so the rule has one home and the phone one answer for it.
  action("/loads/:id/acknowledge", acknowledgeBody, "load.acknowledged", (admin, orgId, driverId, req, body) =>
    acknowledgeLoad(admin, orgId, driverId, pathParam(req, "id"), req.auth!.userId, body),
  );

  // Advance a stop + record its already-uploaded photos. Idempotent on the action id and the photo UUIDs.
  action("/loads/:id/stops/:stopId", completeStopRequestSchema, "load.stop_recorded", (admin, orgId, driverId, req, body) =>
    completeStop(admin, orgId, driverId, pathParam(req, "id"), pathParam(req, "stopId"), req.auth!.userId, body),
  );

  // A late photo for a stop the driver already finished (D-DV30, 0645). Photos only; the stop stays as
  // it was finished. Idempotent on the client photo UUIDs, so an outbox replay is free.
  action(
    "/loads/:id/stops/:stopId/photos",
    addStopPhotosRequestSchema,
    "load.stop_photos_added",
    (admin, orgId, driverId, req, body) =>
      addStopPhotos(admin, orgId, driverId, pathParam(req, "id"), pathParam(req, "stopId"), req.auth!.userId, body),
  );

  return router;
}

/** Express 5 types a path param as `string | string[]`; every route here declares exactly one. */
function pathParam(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
