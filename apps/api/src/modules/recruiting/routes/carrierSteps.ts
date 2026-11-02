import { Router } from "express";
import {
  carrierStepCreateSchema,
  carrierStepRecordSchema,
  carrierStepUpdateSchema,
  type CarrierStepCreate,
  type CarrierStepRecordInput,
  type CarrierStepUpdate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  createCarrierStep,
  isCarrierStepError,
  listCarrierSteps,
  recordApplicantCarrierStep,
  updateCarrierStep,
} from "../carrierSteps.js";

/**
 * The carrier's own hiring steps, office side (HIRING-WORKFLOW-AUDIT-2026-10-31 §10 CE2, 0545).
 *
 * The list lives in Settings → Recruiting beside the videos and the examiners, behind the same doors
 * (`orientationVideos.ts`, §10 Q-CE3): `recruitment` view reads, `recruitment` manage writes. Ticking a
 * step on an applicant is the section's usual act (`notes.ts`): manage.
 *
 * ⚠ The audit row for an applicant's act says WHICH step and what was done, never the note — the same
 * reason `notes.ts` keeps a note's words out of the audit log, which an admin outside hiring can read.
 */
export function recruitmentCarrierStepsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  router.get(
    "/carrier-steps",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ steps: await listCarrierSteps(admin, req.auth!.orgId!) });
    }),
  );

  router.post(
    "/carrier-steps",
    requireOrg,
    canManage,
    validateBody(carrierStepCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const step = await createCarrierStep(admin, orgId, req.auth!.userId, res.locals.body as CarrierStepCreate);
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.hiring_step_added",
        entity: "hiring_carrier_steps", entityId: step.id,
        meta: { label: step.label, afterStep: step.after_step, proof: step.proof, blocksHire: step.blocks_hire },
      });
      res.status(201).json({ step });
    }),
  );

  router.patch(
    "/carrier-steps/:stepId",
    requireOrg,
    canManage,
    validateBody(carrierStepUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const patch = res.locals.body as CarrierStepUpdate;
      const step = await updateCarrierStep(admin, orgId, req.auth!.userId, String(req.params.stepId ?? ""), patch);
      if (isCarrierStepError(step)) {
        res.status(step.status).json(apiError(step.code, step.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId,
        action: patch.retire ? "recruitment.hiring_step_retired" : "recruitment.hiring_step_changed",
        entity: "hiring_carrier_steps", entityId: step.id, meta: { changes: patch },
      });
      res.json({ step });
    }),
  );

  router.post(
    "/applicants/:driverId/carrier-steps/:stepId",
    requireOrg,
    canManage,
    validateBody(carrierStepRecordSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const stepId = String(req.params.stepId ?? "");
      const input = res.locals.body as CarrierStepRecordInput;
      const latest = await recordApplicantCarrierStep(
        admin, orgId,
        { userId: req.auth!.userId, role: req.auth!.role ?? null, email: req.auth!.email ?? null },
        driverId, stepId, input,
      );
      if (isCarrierStepError(latest)) {
        res.status(latest.status).json(apiError(latest.code, latest.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId,
        action: input.act === "done" ? "recruitment.hiring_step_done" : "recruitment.hiring_step_undone",
        entity: "drivers", entityId: driverId,
        meta: { stepId, documentId: latest.documentId },
      });
      res.status(201).json({ latest });
    }),
  );

  return router;
}
