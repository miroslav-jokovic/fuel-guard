import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { drugTestAppointmentSchema, type DrugTestAppointmentBooking } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  arrangeDrugTest,
  cancelDrugTest,
  isDrugTestError,
  listDrugTestAppointments,
  type DrugTestError,
} from "../applicantDrugTest.js";
import { sendDrugTestToDriver } from "../applicantDrugTestSend.js";

/**
 * The drug test's appointment (D-AW6, APPLICATION-FLOW-V2-PLAN §8.4). `applicantDrugTest.ts` carries
 * the reasoning; this file is the guard and the audit trail.
 *
 * Under the recruitment section (GET = view, writes = manage), like every §8.4 route and for
 * `travel.ts`'s reason: arranging a candidate's collection is the recruiter's act.
 *
 * ⚠ The audit names the site and the window and never the donor reference: that number identifies a
 * specimen at the lab, and the audit log is read by more people than the drawer.
 */

const STATUS: Record<DrugTestError["code"], number> = {
  no_invitation: 409,
  not_texted: 409,
  not_found: 404,
  write_failed: 500,
};

const send = (res: Response, e: DrugTestError): void => {
  res.status(STATUS[e.code]).json(apiError(e.code, e.message));
};

export function recruitmentDrugTestRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/applicants/:driverId/drug-test-appointments",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listDrugTestAppointments(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isDrugTestError(result)) return send(res, result);
      res.json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/drug-test-appointments",
    requireOrg,
    requireSection("recruitment"),
    validateBody(drugTestAppointmentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await arrangeDrugTest(
        admin, orgId, req.auth!.userId, driverId, res.locals.body as DrugTestAppointmentBooking,
      );
      if (isDrugTestError(result)) return send(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.drug_test_arranged",
        entity: "drug_test_appointments",
        entityId: result.appointment.id,
        meta: {
          driverId,
          invitationId: result.invitationId,
          siteName: result.appointment.siteName,
          windowStart: result.appointment.windowStart,
          replaced: result.replaced,
        },
      });
      res.status(201).json({ appointment: result.appointment });
    }),
  );

  router.delete(
    "/applicants/:driverId/drug-test-appointments/:appointmentId",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const appointmentId = String(req.params.appointmentId ?? "");
      // A malformed id would reach PostgREST as a 22P02 and come back a 500; it names no appointment.
      if (!z.uuid().safeParse(appointmentId).success) {
        return send(res, { code: "not_found", message: "That appointment is not on this applicant's application." });
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await cancelDrugTest(admin, orgId, driverId, appointmentId);
      if (isDrugTestError(result)) return send(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.drug_test_cancelled",
        entity: "drug_test_appointments",
        entityId: result.appointment.id,
        meta: { driverId, invitationId: result.invitationId },
      });
      res.json({ appointment: result.appointment });
    }),
  );

  /**
   * Text the appointment to the applicant (C2d). Sent now, or queued for their morning — the answer
   * says which, so the drawer never claims a text went that is still waiting.
   */
  router.post(
    "/applicants/:driverId/drug-test-appointments/:appointmentId/send",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const appointmentId = String(req.params.appointmentId ?? "");
      if (!z.uuid().safeParse(appointmentId).success) {
        return send(res, { code: "not_found", message: "That appointment is not on this applicant's application." });
      }
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await sendDrugTestToDriver(admin, env, orgId, driverId, appointmentId, new Date());
      if (isDrugTestError(result)) return send(res, result);
      const { outcome } = result;
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.drug_test_sent",
        entity: "drug_test_appointments",
        entityId: appointmentId,
        // Never the number or the text: the outbox row holds what was sent, the audit that it was.
        meta: { driverId, invitationId: result.invitationId, queued: !outcome.sent },
      });
      res.status(201).json(outcome.sent
        ? { sent: true, queuedUntil: null }
        : { sent: false, queuedUntil: "notBefore" in outcome ? outcome.notBefore : null });
    }),
  );

  return router;
}
