import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  assignmentVoidSchema,
  recordId,
  transponderCreateSchema,
  transponderMoveSchema,
  transponderRetireSchema,
  type TransponderDto,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  isTollServiceError,
  listTransponders,
  moveTransponder,
  registerTransponder,
  retireTransponder,
  statusForTollError,
  voidAssignment,
  type TollServiceError,
} from "../transponders.js";

/**
 * `/api/tolls` — the fleet's toll tags (TOLLS-PER-TRUCK-PLAN.md TL2).
 *
 * ── GATED ON EQUIPMENT ───────────────────────────────────────────────────────────────────────
 * A tag is a thing bolted to a truck's windshield, so it belongs where the truck's other papers do:
 * whoever reads the Vehicles list reads its Toll tags column (`equipment: view`), and whoever keeps
 * the truck's file keeps its tags (`equipment: manage`). The statements and their money will gate on
 * accounting when they arrive (TL4); `check-section-policies` records `tolls` as spanning both.
 *
 * ── EVERY WRITE IS AUDITED ───────────────────────────────────────────────────────────────────
 * The assignment rows carry who opened and who voided them, but not who moved a tag off a truck or
 * retired it, and a toll's truck is read from exactly that history: "who said tag 0081 left truck 654
 * on the 10th" is a question about money. The audit log is where it is answered.
 */

const listQuerySchema = z.object({ vehicleId: recordId().optional() });
const idSchema = recordId();

type Ok = TransponderDto;

function send(res: Response, result: Ok | TollServiceError, status = 200): result is Ok {
  if (isTollServiceError(result)) {
    res.status(statusForTollError(result.code)).json({ ...apiError(result.code, result.error), ...(result.existing ? { existing: result.existing } : {}) });
    return false;
  }
  res.status(status).json({ ok: true, transponder: result });
  return true;
}

function parseId(req: Request, res: Response): string | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json(apiError("bad_request", "That link does not name a toll tag."));
    return null;
  }
  return parsed.data;
}

export function tollsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("equipment", "view");
  const canManage = requireSection("equipment");

  /** Every tag, or with `?vehicleId=` every tag that truck has ever carried. */
  router.get(
    "/transponders",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the truck filter."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listTransponders(admin, req.auth!.orgId!, parsed.data);
      if (isTollServiceError(result)) {
        res.status(statusForTollError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, transponders: result });
    }),
  );

  router.post(
    "/transponders",
    requireOrg,
    canManage,
    validateBody(transponderCreateSchema),
    asyncHandler(async (req, res) => {
      const body = transponderCreateSchema.parse(req.body);
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await registerTransponder(admin, orgId, req.auth!.userId, body);
      if (!send(res, result, 201)) return;
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "tolls.transponder_registered",
        entity: "toll_transponders",
        entityId: result.id,
        meta: { provider: result.provider, tagNumber: result.tagNumber, vehicleId: result.currentVehicleId },
      });
    }),
  );

  router.post(
    "/transponders/:id/move",
    requireOrg,
    canManage,
    validateBody(transponderMoveSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req, res);
      if (!id) return;
      const body = transponderMoveSchema.parse(req.body);
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await moveTransponder(admin, orgId, req.auth!.userId, id, body);
      if (!send(res, result)) return;
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: body.vehicleId ? "tolls.transponder_moved" : "tolls.transponder_removed",
        entity: "toll_transponders",
        entityId: id,
        meta: { tagNumber: result.tagNumber, vehicleId: body.vehicleId, at: body.at },
      });
    }),
  );

  router.post(
    "/transponders/:id/retire",
    requireOrg,
    canManage,
    validateBody(transponderRetireSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req, res);
      if (!id) return;
      const body = transponderRetireSchema.parse(req.body);
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await retireTransponder(admin, orgId, req.auth!.userId, id, body);
      if (!send(res, result)) return;
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "tolls.transponder_retired",
        entity: "toll_transponders",
        entityId: id,
        meta: { tagNumber: result.tagNumber, reason: body.reason, at: body.at },
      });
    }),
  );

  router.post(
    "/assignments/:id/void",
    requireOrg,
    canManage,
    validateBody(assignmentVoidSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req, res);
      if (!id) return;
      const body = assignmentVoidSchema.parse(req.body);
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await voidAssignment(admin, orgId, req.auth!.userId, id, body);
      if (!send(res, result)) return;
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "tolls.assignment_voided",
        entity: "toll_transponder_assignments",
        entityId: id,
        meta: { transponderId: result.id, tagNumber: result.tagNumber, reason: body.reason },
      });
    }),
  );

  return router;
}
