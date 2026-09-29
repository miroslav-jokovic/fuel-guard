import { Router } from "express";
import type { Request, Response } from "express";
import {
  roadTestExaminerCreateSchema,
  roadTestRecordSchema,
  type RoadTestExaminerCreate,
  type RoadTestRecord,
  organizationTimezone,
  todayInZone,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  addRoadTestExaminer,
  isRoadTestError,
  listRoadTestExaminers,
  recordRoadTest,
  retireRoadTestExaminer,
  type RoadTestError,
} from "../roadTest.js";
import { recordPaperCopyGiven, roadTestCertificateCopies } from "../roadTestCertificateCopies.js";

/**
 * The road test (D2) and the examiners who give it — `ROAD-TEST-PLAN.md` RT3.
 *
 * Gated on the RECRUITMENT section, like D1's recorded acts: `road_test` is not a
 * `TESTING_RECORD_KINDS` member, so a recruiter who works the hire may record it, and the examiner's
 * signature is added from the same drawer (Q-RT2).
 */
const statusOf = (e: RoadTestError): number =>
  e.code === "not_found" ? 404 : e.code === "invalid_request" ? 400 : e.code === "already_passed" ? 409 : 500;

export function recruitmentRoadTestRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/road-test-examiners",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ examiners: await listRoadTestExaminers(admin, req.auth!.orgId!) });
    }),
  );

  router.post(
    "/road-test-examiners",
    requireOrg,
    requireSection("recruitment"),
    validateBody(roadTestExaminerCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await addRoadTestExaminer(admin, orgId, req.auth!.userId, res.locals.body as RoadTestExaminerCreate);
      if (isRoadTestError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.road_test_examiner_added",
        entity: "road_test_examiners",
        entityId: result.id,
        // The name and title are what the certificate prints; the signature image is never logged.
        meta: { fullName: result.full_name, title: result.title },
      });
      res.status(201).json({ examiner: result });
    }),
  );

  router.post(
    "/road-test-examiners/:examinerId/retire",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const examinerId = String(req.params.examinerId ?? "");
      const result = await retireRoadTestExaminer(admin, orgId, req.auth!.userId, examinerId);
      if (isRoadTestError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.road_test_examiner_retired",
        entity: "road_test_examiners",
        entityId: examinerId,
        meta: {},
      });
      res.json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/road-test",
    requireOrg,
    requireSection("recruitment"),
    validateBody(roadTestRecordSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const body = res.locals.body as RoadTestRecord;
      // A-12: "today" is the CARRIER's calendar day (`calendarDay.ts`), never UTC's — at 19:00 in
      // Chicago UTC is already tomorrow, and the future-date check let tomorrow's date through.
      const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
      const today = todayInZone(new Date(), organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours));
      const result = await recordRoadTest(
        admin, orgId, req.auth!.userId, req.auth!.role ?? null, driverId, body, today,
      );
      if (isRoadTestError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        // The actor is the office user who recorded it AND applied the examiner's signature (Q-RT2);
        // the examiner is named in meta, so the log says both.
        action: "compliance.road_test_recorded",
        entity: result.recordId ? "qualification_records" : "documents",
        entityId: result.recordId ?? result.formDocumentId,
        meta: {
          driverId,
          examinerId: body.examiner_id,
          testedOn: body.tested_on,
          passed: result.passed,
          formDocumentId: result.formDocumentId,
          certificateDocumentId: result.certificateDocumentId,
        },
      });
      res.status(201).json(result);
    }),
  );

  // G-10 (Q-AW19, owner 2026-09-29): whether the driver has had their copy of each certificate, and the
  // office saying it handed over paper. The act's audit row is written by the service — it IS the record.
  router.get(
    "/applicants/:driverId/road-test/copies",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const copies = await roadTestCertificateCopies(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      res.json({ copies });
    }),
  );

  router.post(
    "/applicants/:driverId/road-test/:recordId/paper-copy",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordPaperCopyGiven(
        admin, req.auth!.orgId!, req.auth!.userId, String(req.params.driverId ?? ""), String(req.params.recordId ?? ""),
      );
      if (isRoadTestError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      res.json({ copy: result });
    }),
  );

  return router;
}
