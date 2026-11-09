import { Router } from "express";
import {
  CLOSE_APPLICATION_PERMISSION,
  hireApplicantSchema,
  type HireApplicant,
} from "@silvicom/shared";
import { requireSection, requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { hireApplicant, isHireError, previewHire } from "../hireApplicant.js";
import { carrierToday } from "../carrierClock.js";
import { requireNamedPermission } from "../../org/index.js";

/**
 * Closing an application — the moment Recruitment hands the file to DQF (H8, D-HIRE2; "Close
 * application" since §14 D-OF5, the same act).
 *
 * ── WHO MAY PRESS IT ───────────────────────────────────────────────────────────────────────────
 * The carrier's named switch `recruitment.close_application` (Settings → Permissions), shipped ON for
 * the safety manager and always held by the admin — the owner's ruling of 2026-11-09: "Safety and
 * admin can close application, and this needs to be in Settings so we can select."
 *
 * It was `roster: manage` from the org's matrix (SP5, 2026-09-30), on the argument that closing flips
 * `drivers.status`, which starts the §391.51(c) retention clock and decides driver-app access. That
 * argument names who must be TRUSTED with the act, not which section answers it, and the section was
 * the wrong unit both ways: it is shipped to the fleet manager (who the owner did not name), and the
 * only way to let a recruiter close was to hand them every roster write. The switch asks exactly this
 * question. The six federal checks still refuse the close whoever presses it (`hireApplicant`).
 *
 * 0213's trigger is not a second gate here: it passes a null `auth_role()`, which is the service role
 * this route writes with (P11, 2026-11-01 — measured, plan §7), so the switch is the whole gate.
 *
 * Everybody who can see the board can read the preview (`GET .../hire-preview`): it is how the person
 * who assembled the file learns that an inquiry marked sent has no date, while there is time to fix it.
 */
export function recruitmentHireRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireSection("recruitment", "view");
  const canClose = requireNamedPermission(CLOSE_APPLICATION_PERMISSION);

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
    canView,
    canClose,
    validateBody(hireApplicantSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as HireApplicant;

      const result = await hireApplicant(
        admin, orgId, req.auth!.userId, body, await carrierToday(admin, orgId),
      );
      if (isHireError(result)) {
        const status =
          result.code === "not_found" ? 404
          : result.code === "not_an_applicant" || result.code === "not_ready_to_hire" ? 409
          : result.code === "hire_failed" ? 500
          : 400;
        // `missing` rides beside the envelope so the screen can name each step (Q-HM5, D-HB5).
        res.status(status).json({ ...apiError(result.code, result.message), missing: result.missing ?? [], missingCarrierSteps: result.missingCarrierSteps ?? [] });
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
