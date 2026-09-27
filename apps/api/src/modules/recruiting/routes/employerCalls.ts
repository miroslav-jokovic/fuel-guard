import { Router } from "express";
import type { Request, Response } from "express";
import { employerVerificationCallSchema, type EmployerVerificationCallInput } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  isEmployerCallError,
  listEmployerCalls,
  recordEmployerCall,
  type EmployerCallError,
} from "../applicantEmployerCalls.js";

/**
 * Previous employers verified by phone before filing (D-AW8, APPLICATION-FLOW-V2-PLAN §8.4).
 * `applicantEmployerCalls.ts` carries the reasoning; this file is the guard and the audit trail.
 *
 * Under the recruitment section (GET = view, writes = manage): §391.23 investigation history is the
 * recruiter's by name (`canReadInvestigationHistory`, §391.53(a)(1)), so no kind gate is needed here —
 * unlike the drug test, nothing this records is a §382.401(a) record.
 *
 * ⚠ The audit names the employer key and the five outcomes, never the person who answered or the
 * corrections: the log is read by more people than the investigation file.
 */

const STATUS: Record<EmployerCallError["code"], number> = {
  no_invitation: 409,
  already_filed: 409,
  employer_not_on_application: 409,
  write_failed: 500,
};

const send = (res: Response, e: EmployerCallError): void => {
  res.status(STATUS[e.code]).json(apiError(e.code, e.message));
};

export function recruitmentEmployerCallsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/applicants/:driverId/employer-calls",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listEmployerCalls(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isEmployerCallError(result)) return send(res, result);
      res.json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/employer-calls",
    requireOrg,
    requireSection("recruitment"),
    validateBody(employerVerificationCallSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await recordEmployerCall(
        admin, orgId, req.auth!.userId, driverId, res.locals.body as EmployerVerificationCallInput,
      );
      if (isEmployerCallError(result)) return send(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.employer_call_recorded",
        entity: "employer_verification_calls",
        entityId: result.call.id,
        meta: {
          driverId,
          invitationId: result.invitationId,
          employerKey: result.call.employerKey,
          outcomes: result.call.outcomes,
        },
      });
      res.status(201).json({ call: result.call });
    }),
  );

  return router;
}
