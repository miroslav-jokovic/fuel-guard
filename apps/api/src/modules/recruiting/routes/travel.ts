import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { applicantTravelSchema, type ApplicantTravelBooking } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { bookTravel, cancelTravel, isTravelError, listTravel, type TravelError } from "../applicantTravel.js";

/**
 * The applicant's trip to the office (D-AW7, APPLICATION-FLOW-V2-PLAN §8.4). `applicantTravel.ts`
 * carries the reasoning; this file is the guard and the audit trail.
 *
 * Under the recruitment section (GET = view, writes = manage), like every §8.4 route: booking a
 * candidate's travel is the recruiter's act, and gating it on `roster` would be the widening
 * RECRUITER-ROLE-SCOPE.md's Option B refuses.
 */

const STATUS: Record<TravelError["code"], number> = {
  not_found: 404,
  no_invitation: 409,
  // ⚠ 409, not 400: the body is fine, the applicant's state is not — `hire.ts`'s `not_ready_to_hire`.
  not_ready_to_travel: 409,
  write_failed: 500,
};

const send = (res: Response, e: TravelError): void => {
  res.status(STATUS[e.code]).json({ ...apiError(e.code, e.message), ...(e.missing ? { missing: e.missing } : {}) });
};

export function recruitmentTravelRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/applicants/:driverId/travel",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listTravel(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isTravelError(result)) return send(res, result);
      res.json(result);
    }),
  );

  router.post(
    "/applicants/:driverId/travel",
    requireOrg,
    requireSection("recruitment"),
    validateBody(applicantTravelSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await bookTravel(
        admin, orgId, req.auth!.userId, driverId, res.locals.body as ApplicantTravelBooking,
        new Date().toISOString().slice(0, 10),
      );
      if (isTravelError(result)) return send(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.travel_booked",
        entity: "applicant_travel",
        entityId: result.trip.id,
        // No confirmation reference: it is a booking credential at an airline, and the log is read by
        // more people than the drawer.
        meta: {
          driverId,
          invitationId: result.invitationId,
          mode: result.trip.mode,
          departAt: result.trip.departAt,
          arriveAt: result.trip.arriveAt,
          replaced: result.replaced,
        },
      });
      res.status(201).json({ trip: result.trip });
    }),
  );

  router.delete(
    "/applicants/:driverId/travel/:travelId",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req: Request, res: Response) => {
      const travelId = String(req.params.travelId ?? "");
      // A malformed id would reach PostgREST as a 22P02 and come back a 500; it names no trip.
      if (!z.uuid().safeParse(travelId).success) {
        return send(res, { code: "not_found", message: "That trip is not on this applicant's application." });
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const result = await cancelTravel(admin, orgId, driverId, travelId);
      if (isTravelError(result)) return send(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruiting.travel_cancelled",
        entity: "applicant_travel",
        entityId: result.trip.id,
        meta: { driverId, invitationId: result.invitationId },
      });
      res.json({ trip: result.trip });
    }),
  );

  return router;
}
