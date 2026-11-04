import { Router } from "express";
import {
  carrierQuestionCreateSchema,
  carrierQuestionUpdateSchema,
  type CarrierQuestionCreate,
  type CarrierQuestionUpdate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  createCarrierQuestion,
  isCarrierQuestionError,
  listCarrierQuestions,
  updateCarrierQuestion,
} from "../carrierQuestions.js";

/**
 * The carrier's own application questions, office side (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3 CQ2, 0567).
 * Settings → Recruiting, behind the carrier steps' doors (`carrierSteps.ts`): `recruitment` view reads,
 * `recruitment` manage writes.
 */
export function recruitmentCarrierQuestionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  router.get(
    "/carrier-questions",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ questions: await listCarrierQuestions(admin, req.auth!.orgId!) });
    }),
  );

  router.post(
    "/carrier-questions",
    requireOrg,
    canManage,
    validateBody(carrierQuestionCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const question = await createCarrierQuestion(admin, orgId, req.auth!.userId, res.locals.body as CarrierQuestionCreate);
      if (isCarrierQuestionError(question)) {
        res.status(question.status).json(apiError(question.code, question.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.question_added",
        entity: "recruiting_carrier_questions", entityId: question.id,
        meta: { kind: question.kind, required: question.required },
      });
      res.status(201).json({ question });
    }),
  );

  router.patch(
    "/carrier-questions/:questionId",
    requireOrg,
    canManage,
    validateBody(carrierQuestionUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const patch = res.locals.body as CarrierQuestionUpdate;
      const question = await updateCarrierQuestion(admin, orgId, req.auth!.userId, String(req.params.questionId ?? ""), patch);
      if (isCarrierQuestionError(question)) {
        res.status(question.status).json(apiError(question.code, question.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId,
        action: patch.retire ? "recruitment.question_retired" : "recruitment.question_changed",
        entity: "recruiting_carrier_questions", entityId: question.id, meta: { changes: patch },
      });
      res.json({ question });
    }),
  );

  return router;
}
