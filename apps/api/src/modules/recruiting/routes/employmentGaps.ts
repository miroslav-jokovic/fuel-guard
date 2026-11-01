import { Router } from "express";
import { employmentGapCreateSchema, isRecordId, type EmploymentGapCreate } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  isGapRefusal,
  listEmploymentGaps,
  recordEmploymentGap,
  withdrawEmploymentGap,
  type GapRefusal,
} from "../employmentGaps.js";

/**
 * Employment gaps on the record after signing (HW5c, 0538). Under the recruitment section, as the
 * employment history beside them: reads are view, writes are manage. `employmentGaps.ts` has the
 * reasoning. The audit names the dates, never the explanation — the log is read by more people than the
 * qualification file.
 */
const STATUS: Record<GapRefusal["code"], number> = { not_found: 404, already_withdrawn: 409, db_error: 500 };

export function recruitmentEmploymentGapsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  router.get(
    "/applicants/:driverId/employment-gaps",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listEmploymentGaps(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isGapRefusal(result)) {
        res.status(STATUS[result.code]).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/employment-gaps",
    requireOrg,
    canManage,
    validateBody(employmentGapCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const body = res.locals.body as EmploymentGapCreate;
      const gap = await recordEmploymentGap(
        admin, orgId, { userId: req.auth!.userId, role: req.auth!.role ?? null, email: req.auth!.email ?? null }, driverId, body,
      );
      if (isGapRefusal(gap)) {
        res.status(STATUS[gap.code]).json(apiError(gap.code, gap.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.employment_gap_recorded",
        entity: "driver_employment_gaps",
        entityId: gap.id,
        meta: { driverId, startedOn: gap.startedOn, endedOn: gap.endedOn },
      });
      res.status(201).json({ gap });
    }),
  );

  router.post(
    "/applicants/:driverId/employment-gaps/:gapId/withdraw",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const gapId = String(req.params.gapId ?? "");
      if (!isRecordId(gapId)) {
        res.status(404).json(apiError("not_found", "Gap not found"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const gap = await withdrawEmploymentGap(admin, orgId, req.auth!.userId, driverId, gapId);
      if (isGapRefusal(gap)) {
        res.status(STATUS[gap.code]).json(apiError(gap.code, gap.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.employment_gap_withdrawn",
        entity: "driver_employment_gaps",
        entityId: gap.id,
        meta: { driverId },
      });
      res.json({ gap });
    }),
  );

  return router;
}
