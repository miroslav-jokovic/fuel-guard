import { Router } from "express";
import {
  canReadInvestigationHistory,
  employerResponseDocumentSchema,
  inquiryAttemptSchema,
  inquiryOutcomeSchema,
  rolesThatManage,
  type EmployerResponseDocument,
  type InquiryAttempt,
  type InquiryOutcomeUpdate,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { loadInquiryQueue } from "../../services/inquiryQueue.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import {
  isInquiryError,
  listInquiries,
  previewInquiry,
  recordInquiryAttempt,
  recordInquiryOutcome,
  registerInquiryDocument,
} from "../../services/employerInquiry.js";

/**
 * The §391.23 previous-employer inquiry (EMPLOYER-INQUIRY-PLAN E3).
 *
 * ── WHO MAY SEE ANY OF THIS ────────────────────────────────────────────────────────────────────
 * §391.23(k)(2): "take all precautions reasonably necessary to protect the records from disclosure
 * to any person not directly involved in deciding whether to hire the driver." That is
 * `canReadInvestigationHistory` — the same population 0211/0217 restrict the resulting qualification
 * records to, and the same intersection with the section the PSP routes use. A fleet_manager manages
 * Recruitment and is refused here, because they may not read what these letters bring back.
 *
 * ── THE ROUTE DOES NOT SEND EMAIL, AND THAT IS THE CURRENT DECISION, NOT AN OVERSIGHT ──────────
 * Sending on the carrier's behalf from our domain is Q-PEI2 and unanswered — it is a deliverability
 * and an impersonation question at once, and the reply-to has to land somewhere a person reads.
 * §391.23(c)(2) asks for a record of "the date the previous employer was contacted, or the attempts
 * made", not for proof that we operated the mail server. So this composes the letter, the operator
 * sends it however that employer actually answers, and the record is made either way (D-PEI6).
 */
export function recruitmentInquiriesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canInvestigate = requireRole(
    ...rolesThatManage("recruitment").filter(canReadInvestigationHistory),
  );

  /**
   * The fleet-wide queue (E5): every file with §391.23 work left, closest to its own deadline first.
   *
   * Same guard as everything else here. The rows name drivers and former employers, which is exactly
   * what §391.23(k)(2) says to keep away from anyone not involved in the hiring decision — a queue
   * is not less restricted than the records it summarises.
   */
  router.get(
    "/inquiry-queue",
    requireOrg,
    canInvestigate,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await loadInquiryQueue(admin, req.auth!.orgId!, new Date().toISOString().slice(0, 10)));
    }),
  );

  /** The letter this employer would get, composed but not recorded. */
  router.get(
    "/employment/:employmentId/inquiry-preview",
    requireOrg,
    canInvestigate,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const kind = req.query.kind === "drug_alcohol" ? "drug_alcohol" : "safety_performance";
      const result = await previewInquiry(
        admin, req.auth!.orgId!, String(req.params.employmentId ?? ""), kind,
      );
      if (isInquiryError(result)) {
        res.status(404).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  /** Every attempt on one driver's file — the §391.23(c)(2) record as an auditor reads it. */
  router.get(
    "/drivers/:driverId/inquiries",
    requireOrg,
    canInvestigate,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { rows } = await listInquiries(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      res.json({ inquiries: rows });
    }),
  );

  router.post(
    "/inquiries",
    requireOrg,
    canInvestigate,
    validateBody(inquiryAttemptSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as InquiryAttempt;

      const result = await recordInquiryAttempt(admin, orgId, req.auth!.userId, body);
      if (isInquiryError(result)) {
        const status =
          result.code === "not_found" ? 404
          : result.code === "insert_failed" ? 500
          : 422;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.employer_inquiry_sent",
        entity: "employer_inquiries",
        entityId: result.id,
        // The version, the manner and the date — never `sent_to`, which is a former employer's
        // contact detail, nor the body, which the row already holds in full.
        meta: { employmentId: body.employment_id, kind: body.kind, method: body.method, contactedOn: body.contacted_on },
      });

      res.status(201).json({ id: result.id });
    }),
  );

  /** Register the returned letter before uploading it; the kind is forced server-side (E4). */
  router.post(
    "/inquiries/:id/document",
    requireOrg,
    canInvestigate,
    validateBody(employerResponseDocumentSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await registerInquiryDocument(
        admin, req.auth!.orgId!, req.auth!.userId, String(req.params.id ?? ""),
        res.locals.body as EmployerResponseDocument,
      );
      if (isInquiryError(result)) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json(result);
    }),
  );

  /**
   * What came back, or that nothing did.
   *
   * A documented non-response is an ANSWER (§391.23(c)(1)) and is recorded as one. 0223's trigger
   * refuses any edit to what was sent, so this can only add an outcome to an existing attempt.
   */
  router.post(
    "/inquiries/:id/outcome",
    requireOrg,
    canInvestigate,
    validateBody(inquiryOutcomeSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as InquiryOutcomeUpdate;

      const result = await recordInquiryOutcome(admin, orgId, String(req.params.id ?? ""), body);
      if (isInquiryError(result)) {
        const status =
          result.code === "not_found" ? 404
          : result.code === "update_failed" ? 500
          : 422;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.employer_inquiry_answered",
        entity: "employer_inquiries",
        entityId: result.id,
        // Counts, never contents: what a former employer said about a driver's accidents is
        // §391.23(k) material and belongs in the row, not in a log every admin can read.
        meta: {
          employmentId: result.employmentId,
          outcome: body.outcome,
          outcomeOn: body.outcome_on,
          accidentsReported: body.response?.accidents.length ?? null,
          documentFiled: Boolean(body.document_id),
        },
      });

      res.json({ id: result.id });
    }),
  );

  return router;
}
