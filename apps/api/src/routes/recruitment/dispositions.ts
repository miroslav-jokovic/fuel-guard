import { Router } from "express";
import {
  applicantDispositionCreateSchema,
  isCarrierDecision,
  rolesThatCanView,
  rolesThatManage,
  type ApplicantDispositionCreate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Why an application ended without a hire (0238).
 *
 * ── WHO MAY DECIDE, AND WHO MAY LOOK ──────────────────────────────────────────────────────────
 * `recruitment` manage to write, `recruitment` view to read. NOT the investigation-history
 * population that `inquiries.ts` gates on: a disposition says *that* somebody was declined and the
 * carrier's own sentence about why. It is not a §391.53(a)(1) record and it carries nothing from a
 * previous employer or a vendor — the one field that touches a purchased report is a boolean saying
 * one was involved, which is a fact about the decision, not a fact from the report.
 *
 * ⚠ **`rested_on_consumer_report` is written and never acted on, today.** FCRA notices are R10's,
 * blocked on Q-REC8 and Q7. It is captured now because whether a recruiter had a bought report in
 * front of them when they said no is knowable at the moment of the decision and a guess afterwards.
 */
export function recruitmentDispositionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireRole(...rolesThatManage("recruitment"));
  const canView = requireRole(...rolesThatCanView("recruitment"));

  const COLS = "id, driver_id, outcome, decided_on, reason, rested_on_consumer_report, decided_by, created_at";

  /** Newest first — a correction is a new row, so the top of this list is the current answer. */
  router.get(
    "/drivers/:driverId/dispositions",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("applicant_dispositions")
        .select(COLS)
        .eq("org_id", req.auth!.orgId!)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("decided_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load the decision history"));
        return;
      }
      res.json({ dispositions: data ?? [] });
    }),
  );

  router.post(
    "/dispositions",
    requireOrg,
    canManage,
    validateBody(applicantDispositionCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as ApplicantDispositionCreate;

      // The driver has to be this org's. A 404 rather than a 403: a caller guessing ids learns
      // nothing about whether the id exists somewhere else.
      const { data: driver } = await admin
        .from("drivers")
        .select("id, full_name, status")
        .eq("org_id", orgId)
        .eq("id", body.driver_id)
        .maybeSingle();
      const row = driver as { id: string; full_name: string; status: string } | null;
      if (!row) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }
      /**
       * ⚠ **An active driver is not an applicant, and this is not how you fire somebody.**
       *
       * Refused rather than allowed-and-ignored, because the two acts have completely different
       * consequences: a disposition ends an APPLICATION, and ending an employment is a termination
       * with its own date, its own §391.51(c) retention clock and its own effect on the DQ file.
       * Letting this endpoint write against an active driver would put "declined" on the record of
       * somebody the carrier employs.
       */
      if (row.status !== "applicant") {
        res.status(409).json(apiError(
          "not_an_applicant",
          `${row.full_name} is already ${row.status}. Ending an employment is not the same act as deciding on an application.`,
        ));
        return;
      }

      const { data, error } = await admin
        .from("applicant_dispositions")
        .insert({
          org_id: orgId,
          driver_id: body.driver_id,
          outcome: body.outcome,
          decided_on: body.decided_on,
          reason: body.reason ?? null,
          rested_on_consumer_report: body.rested_on_consumer_report,
          // Server-stamped. A client that could name the decider could name somebody else.
          decided_by: req.auth!.userId,
        })
        .select(COLS)
        .maybeSingle();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not record the decision"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.applicant_dispositioned",
        entity: "drivers",
        entityId: body.driver_id,
        /**
         * ⚠ The outcome and whether a purchased report was involved — **never the reason text.**
         * The audit log is readable by an admin who has no part in hiring, and a recruiter's sentence
         * about why somebody was turned down is exactly the kind of thing §391.23(k)(2) keeps to the
         * people deciding. The row itself is behind the recruitment section; the audit entry says
         * that a decision happened, not what was said about the person.
         */
        meta: {
          outcome: body.outcome,
          decidedOn: body.decided_on,
          carrierDecision: isCarrierDecision(body.outcome),
          restedOnConsumerReport: body.rested_on_consumer_report,
        },
      });

      res.status(201).json({ disposition: data });
    }),
  );

  return router;
}
