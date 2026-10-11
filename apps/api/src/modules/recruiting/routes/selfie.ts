import { Router } from "express";
import type { Request, Response } from "express";
import { selfieVerdictSchema, type SelfieVerdictInput } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { isSelfieError, readSelfieCheck, recordSelfieVerdict, type SelfieError } from "../applicantSelfie.js";

/**
 * The selfie beside the licence photo, and the office's reading of it (AW6, §6.7, D-AW10 phase 1).
 * `applicantSelfie.ts` carries the reasoning; this file is the guard and the audit trail.
 *
 * Under the recruitment section (GET = view, the reading = manage) — the recruiter who reads Part 1
 * already sees the licence photo, and the selfie is the same person's face beside it.
 *
 * ⚠ The audit names the reading and the invitation, never a URL: a signed URL is a bearer credential
 * for a face for five minutes, and the log is read by more people than the drawer.
 */

const STATUS: Record<SelfieError["code"], number> = {
  no_invitation: 409,
  no_selfie: 409,
  write_failed: 500,
};

export function recruitmentSelfieRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/applicants/:driverId/intake/selfie",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      // A face, even for five minutes: never kept by a browser or a proxy.
      res.setHeader("Cache-Control", "no-store");
      res.json(await readSelfieCheck(admin, req.auth!.orgId!, String(req.params.driverId ?? "")));
    }),
  );

  router.post(
    "/applicants/:driverId/intake/selfie-verdict",
    requireOrg,
    requireSection("recruitment"),
    validateBody(selfieVerdictSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const { verdict } = res.locals.body as SelfieVerdictInput;
      const result = await recordSelfieVerdict(admin, orgId, req.auth!.userId, driverId, verdict, new Date());
      if (isSelfieError(result)) {
        res.status(STATUS[result.code]).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.selfie_verdict_recorded",
        entity: "application_intakes",
        entityId: result.invitationId,
        meta: { driverId, invitationId: result.invitationId, verdict },
      });
      res.json({ verdict: result.verdict, at: result.at });
    }),
  );

  return router;
}
