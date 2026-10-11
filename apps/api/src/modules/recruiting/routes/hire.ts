import { Router } from "express";
import {
  hireApplicantSchema,
  type HireApplicant,
} from "@silvicom/shared";
import { requireSection, requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { hireApplicant, isHireError, previewHire } from "../hireApplicant.js";

/**
 * Hiring an applicant — the moment Recruitment hands the file to DQF (H8, D-HIRE2).
 *
 * ── WHY A RECRUITER MAY NOT PRESS THIS BUTTON ──────────────────────────────────────────────────
 * They own everything up to it: the applicant's row, the employment history, the signed releases,
 * the screening. Hiring flips `drivers.status`, and that is not a recruitment act — 0213 says so in
 * a trigger and `canWriteDriverLifecycle` says so in the matrix, because the status column starts
 * the §391.51(c) retention clock and decides driver-app access. Making the hire endpoint the one
 * exception would leave the trigger refusing the very call the API had just authorised.
 *
 * So: a recruiter can SEE what hiring would file (`GET .../hire-preview`, the recruitment section's
 * own read gate) and cannot perform it. The preview is not a courtesy — it is how the person who
 * assembled the file learns that an inquiry marked sent has no date, while there is still time to
 * fix it.
 */
export function recruitmentHireRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireSection("recruitment", "view");
  // `roster: manage`, read from the ORG's matrix (the `sections` claim) — SP5, plan §4b, owner ruling
  // 2026-09-30. This was `requireRole(...USER_ROLES.filter(canWriteDriverLifecycle))`, which is the
  // same predicate (`canWriteDriverLifecycle` IS `canManageSection(role, "roster")`) asked of the
  // SHIPPED matrix: a role the admin granted roster manage was refused the hire, and a role the admin
  // narrowed out of it was still let through. The web's Hire… asks `session.can("roster")`, the same
  // question, so the button and the endpoint cannot disagree again.
  //
  // 0213's trigger still names the three shipped roles, and that does not reopen the gap: it passes a
  // null `auth_role()`, which is the service role this route writes with, so for the API this
  // middleware is the whole gate. The trigger is the lock on a CLIENT write to `drivers.status`.
  const canHire = requireSection("roster");

  router.get(
    "/drivers/:driverId/hire-preview",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await previewHire(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isHireError(result)) {
        res.status(404).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  router.post(
    "/hire",
    requireOrg,
    canHire,
    validateBody(hireApplicantSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as HireApplicant;

      const result = await hireApplicant(
        admin, orgId, req.auth!.userId, body, new Date().toISOString().slice(0, 10),
      );
      if (isHireError(result)) {
        const status =
          result.code === "not_found" ? 404
          : result.code === "not_an_applicant" || result.code === "not_ready_to_hire" ? 409
          : result.code === "hire_failed" ? 500
          : 400;
        // `missing` rides beside the envelope so the screen can name each step (Q-HM5, D-HB5).
        res.status(status).json({ ...apiError(result.code, result.message), missing: result.missing ?? [] });
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.applicant_hired",
        entity: "drivers",
        entityId: body.driver_id,
        // What was filed and what was NOT: an audit entry that recorded only the success would make
        // the gap in the file look like something nobody was told about.
        meta: {
          hireDate: body.hire_date,
          filed: result.filed,
          skipped: result.skipped.map((s) => ({ employmentId: s.employmentId, reason: s.reason })),
          outstanding: result.outstanding.map((o) => o.key),
          // H8's honesty applied to §40.25(j): the audit says the carrier hired somebody it may not
          // yet put behind the wheel. A gap the entry did not mention is a gap nobody was told about.
          returnToDutyBlocked: result.returnToDutyBlocked,
        },
      });

      res.status(200).json(result);
    }),
  );

  return router;
}
