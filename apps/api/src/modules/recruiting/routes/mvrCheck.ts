import { Router } from "express";
import type { Request, Response } from "express";
import { mvrCheckStartSchema, type MvrCheckStart } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { isMvrCheckError, readMvrCheck, startMvrCheck, type MvrCheckError } from "../mvrCheck.js";
import { carrierToday } from "../carrierClock.js";

/**
 * The AI check of a driving record (HIRING-WORKFLOW-AUDIT §14, OF6b): start reading an MVR scan the recruiter
 * just dropped, then poll for what it says. `mvrCheck.ts` carries the reasoning.
 *
 * WHO: the `recruitment` section — `manage` to start a read (it spends a model call), `view` to look at one.
 * An MVR is not a `TESTING_RECORD_KINDS` record (§382.401(a) is drug and alcohol), so no kind test follows,
 * unlike the hiring-evidence door beside this one.
 */
const STATUS: Record<MvrCheckError["code"], number> = {
  not_found: 404, invalid_request: 400, not_uploaded: 409, reading_off: 409, failed: 500,
};

export function mvrCheckRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/applicants/:driverId/mvr-check",
    requireOrg,
    requireSection("recruitment"),
    validateBody(mvrCheckStartSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const body = res.locals.body as MvrCheckStart;
      const result = await startMvrCheck(admin, env, orgId, req.auth!.userId, driverId, body.document_id);
      if (isMvrCheckError(result)) {
        res.status(STATUS[result.code]).json(apiError(result.code, result.message));
        return;
      }
      // A model read of a person's driving record is worth a ledger line: who asked, for whom, which file.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.mvr_check_started",
        entity: "documents",
        entityId: body.document_id,
        meta: { driverId },
      });
      res.status(202).json({ documentId: body.document_id });
    }),
  );

  router.get(
    "/applicants/:driverId/mvr-check/:documentId",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await readMvrCheck(
        admin, orgId, String(req.params.driverId ?? ""), String(req.params.documentId ?? ""), await carrierToday(admin, orgId),
      );
      if (isMvrCheckError(result)) {
        res.status(STATUS[result.code]).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  return router;
}
