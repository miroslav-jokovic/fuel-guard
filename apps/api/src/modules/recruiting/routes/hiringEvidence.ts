import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import {
  canReadRestrictedKind,
  hiringEvidenceFileSchema,
  hiringEvidenceUploadSchema,
  hiringRecordedActKind,
  type HiringEvidenceFiling,
  type HiringEvidenceUpload,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  fileHiringEvidence,
  isHiringEvidenceError,
  registerHiringEvidenceDocument,
} from "../hiringEvidence.js";

/**
 * The MVR, the Clearinghouse query and the drug test, recorded where the hire is worked — D1.
 *
 * Two calls, `/psp-imports`' shape: register the scan and PUT it to the signed URL, then file the
 * record. `services/hiringEvidence.ts` carries the reasoning for the shape and
 * `packages/shared/src/hiringEvidence.ts` the reasoning for the rules; this file is the guard and
 * the audit trail.
 *
 * ── WHO MAY FILE ONE, AND WHY IT IS AN INTERSECTION AGAIN ─────────────────────────────────────
 * `rolesThatManage("recruitment")` is admin, fleet_manager, safety_manager and recruiter — and two
 * of the three kinds this door files are `TESTING_RECORD_KINDS`, which §382.401(a) keeps with the
 * admin and the safety manager. A recruiter filing a drug-test result would be filing evidence into
 * a class they cannot open: they could not check what they filed, correct a wrong entry, or answer
 * a question about it. So the guard is the SECTION and then the kind's own reader test.
 *
 * ⚠ **The kind test cannot be a role list computed at module load, and that is the difference from
 * `/psp-imports`.** That router always files `psp_report`, so `requireRole(...USER_ROLES.filter(
 * canReadInvestigationHistory))` says everything. Here the kind comes from the `:step` segment and
 * differs per request — a recruiter may record the driving record and may not record the drug test —
 * so the test runs per request, against the same `canReadRestrictedKind` predicate the compliance
 * routes and 0211's policies use. One predicate, three enforcement layers; a hand-written list here
 * would be the fourth answer and the one that drifts.
 */
export function recruitmentHiringEvidenceRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * §382.401(a) / §391.53(a)(1), per request rather than per router.
   *
   * ⚠ An unrecognised step PASSES this gate deliberately and is refused by the service as a 400.
   * "You may not read this class of record" and "that step is not recorded this way" are different
   * answers, and collapsing them into a 403 would tell a recruiter they lack permission for a step
   * that nobody can file here at all.
   *
   * ⚠ Keep the `gateKind` marker — `routeGates.test.ts` walks the mounted stacks and can only see a
   * gate that declares itself (D-SEP10).
   */
  const canReadTheKind = Object.assign(
    (req: Request, res: Response, next: NextFunction): void => {
      const kind = hiringRecordedActKind(String(req.params.step ?? ""));
      if (kind && !canReadRestrictedKind(kind, req.auth?.role ?? null)) {
        res
          .status(403)
          .json(apiError("forbidden", "Drug & alcohol records require a safety manager or admin."));
        return;
      }
      next();
    },
    { gateKind: "role" as const },
  );

  const canFile = [requireSection("recruitment"), canReadTheKind];

  router.post(
    "/applicants/:driverId/records/:step/document",
    requireOrg,
    canFile,
    validateBody(hiringEvidenceUploadSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = res.locals.body as HiringEvidenceUpload;
      const result = await registerHiringEvidenceDocument(
        admin,
        req.auth!.orgId!,
        req.auth!.userId,
        String(req.params.driverId ?? ""),
        String(req.params.step ?? ""),
        body,
      );
      if (isHiringEvidenceError(result)) {
        res
          .status(result.code === "not_found" ? 404 : result.code === "sign_failed" ? 500 : 400)
          .json(apiError(result.code, result.message));
        return;
      }
      // No audit here, for `/psp-imports/document`'s reason: a registration without an upload is an
      // intent rather than an act, and the filing below is the event a §391.51 review cares about.
      res.status(201).json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/records/:step",
    requireOrg,
    canFile,
    validateBody(hiringEvidenceFileSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const step = String(req.params.step ?? "");
      const body = res.locals.body as HiringEvidenceFiling;

      const result = await fileHiringEvidence(
        admin, orgId, req.auth!.userId, driverId, step, body, new Date().toISOString().slice(0, 10),
      );
      if (isHiringEvidenceError(result)) {
        const status = result.code === "not_found" ? 404 : result.code === "insert_failed" ? 500 : 400;
        // One message: `validateHiringEvidence` reports on a single hand-typed field, so the first
        // issue IS the answer — the same call every other router in this section makes.
        res.status(status).json(apiError(result.code, result.issues?.[0]?.message ?? result.message));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        // Its own action rather than `compliance.qualification_recorded`, on `/psp-imports`'
        // precedent: what a later reader needs from the log is that this row was RECORDED by an
        // office from a printout, not fetched — which is the whole of D-HM6.
        action: "compliance.hiring_act_recorded",
        entity: "qualification_records",
        entityId: result.recordId,
        meta: {
          driverId,
          step,
          kind: result.kind,
          occurredOn: body.occurred_on,
          documentId: result.documentId,
        },
      });
      res.status(201).json(result);
    }),
  );

  return router;
}
