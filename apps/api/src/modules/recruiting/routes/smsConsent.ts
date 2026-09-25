import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { smsConsentStatus, withdrawSmsConsent } from "../applicationSms.js";

/**
 * The office's side of an applicant's consent to be texted (SMS-OPT-IN-PLAN SMS4).
 *
 * ── READ AT `view`, STOP AT MANAGE ─────────────────────────────────────────────────────────────
 * Reading it is the checklist's argument (`checklist.ts`): anybody who can see an applicant can see
 * whether a text will reach them, and it carries four digits and a date — nothing to redact.
 *
 * Recording a stop is a write, so it takes the section's manage grant like every other write here.
 * ⚠ There is deliberately NO route that grants. A consent must be the applicant's own act on their
 * own link (D-SMS1, D-SMS3): an office-recorded "they said yes on the phone" is the weakest evidence
 * the TCPA admits, and memo Q12 has not ruled that it is enough. The `office` source in 0233's CHECK
 * stays unused until it does.
 *
 * ── WHY THE OFFICE CAN STOP IT AT ALL ─────────────────────────────────────────────────────────
 * 47 CFR §64.1200(a)(10), as the FCC's 2024 order amended it: consent may be revoked "by any
 * reasonable means", and a call to the recruiter is one. Before this route there was nowhere to put
 * that call, so the only honoured revocation was a STOP by text.
 */
export function recruitmentSmsConsentRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const driverOf = (req: { params: Record<string, unknown> }): string => String(req.params.driverId ?? "");

  router.get(
    "/applicants/:driverId/sms-consent",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, status: await smsConsentStatus(admin, req.auth!.orgId!, driverOf(req)) });
    }),
  );

  router.post(
    "/applicants/:driverId/sms-consent/withdraw",
    requireOrg,
    requireSection("recruitment"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = driverOf(req);
      const revoked = await withdrawSmsConsent(
        admin, orgId, driverId, `asked the office to stop; recorded by user ${req.auth!.userId}`,
      );
      if (revoked === 0) {
        res.status(409).json(apiError("no_live_sms_consent", "This applicant has not agreed to texts, so there is nothing to stop."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.sms_consent_withdrawn",
        entity: "drivers",
        entityId: driverId,
        // A count and never the number — an audit log is not a place a phone number needs to live.
        meta: { revoked },
      });
      res.json({ ok: true, status: await smsConsentStatus(admin, orgId, driverId) });
    }),
  );

  return router;
}
