import { Router } from "express";
import {
  applicantIntakeLicencesSchema,
  applicantIntakeSchema,
  type ApplicantIntake,
  type ApplicantIntakeLicences,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isIntakeError, type IntakeError } from "../applicationIntake.js";
import { completeIntake, recordIntake } from "../applicantIntake.js";

/**
 * Part 1 of the link — "get started" (APPLICATION-FLOW-V2-PLAN.md §6.2, §8.4, AW2). Mounted at the
 * public application router's root, so the paths are `/:token/intake…`, behind the same per-link
 * bucket as every other write on the link (`applicationLimits.ts`).
 *
 * The refusal vocabulary is `publicApplication.ts`'s: `invalid_link` for anything that would tell an
 * anonymous caller a token existed, and 409 for the "not yet" and "not any more" answers only the
 * holder of a live link can reach, which therefore disclose nothing.
 */

/** 404 for a dead link, 400 for a malformed body, 409 for a live link in the wrong state. */
function statusOf(result: IntakeError): number {
  switch (result.code) {
    case "invalid_link":
      return 404;
    case "invalid_request":
      return 400;
    case "already_submitted":
    case "esign_consent_required":
    case "fcra_summary_changed":
    case "intake_frozen":
    case "intake_incomplete":
    case "prior_positive_required":
      return 409;
    default:
      // `capture_promotion_failed` among them: the bytes did not move, nothing was filed, and pressing
      // Continue again retries the same set.
      return 500;
  }
}

export function publicApplicationIntakeRouter(): Router {
  const router = Router();

  /** One Part 1 screen's answers. Present keys are written, absent keys are kept (0376). */
  router.post(
    "/:token/intake",
    validateBody(applicantIntakeSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordIntake(
        admin, String(req.params.token ?? ""), { intake: res.locals.body as ApplicantIntake }, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      // Names of fields that kept a value already on file — never the values (D-APP16).
      res.status(201).json({ ok: true, keptExisting: result.keptExisting });
    }),
  );

  /** Every licence held in three years, the current CDL first — replacing the stored list. */
  router.post(
    "/:token/intake/licences",
    validateBody(applicantIntakeLicencesSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = res.locals.body as ApplicantIntakeLicences;
      const result = await recordIntake(
        admin, String(req.params.token ?? ""), { licences: body.licences }, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, keptExisting: result.keptExisting, licenceCount: result.licenceCount });
    }),
  );

  /**
   * Finish Part 1. The body carries nothing — what is recorded is an act, and what it is about is
   * already on the server. Idempotent: a second press answers with the first stamp.
   */
  router.post(
    "/:token/intake/complete",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await completeIntake(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(result)) {
        res.status(statusOf(result)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, intakeCompletedAt: result.intakeCompletedAt });
    }),
  );

  return router;
}
