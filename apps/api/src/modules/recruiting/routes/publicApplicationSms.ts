import { Router } from "express";
import {
  SMS_CONSENT,
  composeSmsConsent,
  smsConsentGrantSchema,
  smsOptInConfirmation,
  type ApplicantSmsConsent,
  type SmsConfirmation,
  type SmsConsentGrant,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { isIntakeError, requireEsignConsent, resolveInvitation } from "../applicationIntake.js";
import { carrierName } from "../applicationMail.js";
import { loadCarrierWording } from "../carrierWording.js";
import {
  recordSmsConsent,
  sendApplicationSms,
  smsConsentStatus,
  withdrawSmsConsent,
} from "../applicationSms.js";

/**
 * The applicant agreeing to be texted, on their own link (SMS-OPT-IN-PLAN SMS1, D-SMS1).
 *
 * ── WHY IT IS HERE AND NOT ON THE APPLICATION FORM ────────────────────────────────────────────
 * A11b's comment put the checkbox inside the form. The application link is one of the things we want
 * to text, and a consent collected behind it cannot authorise sending it. So the offer is made on
 * the waiting screens, which the applicant reaches as soon as their permissions are signed and before
 * the office sends the form (D-SMS1). Nothing on the link waits on the answer: this is the one write
 * on the public surface that is optional by law — 47 CFR §64.1200(f)(9)(i)(B) — and it is built so
 * that no screen can make it otherwise.
 *
 * ── THE SAME RULES AS EVERY OTHER ACT ON THIS SURFACE ─────────────────────────────────────────
 * The token resolves the org; nothing here reads a tenant from the request. A dead link answers the
 * one `invalid_link`. The consent text is composed server-side and the request carries the act and
 * the number, never the words. And §390.32(d)'s ESIGN consent comes first, as it does for every
 * signature — the card only appears after it, and the server does not take the card's word for that.
 *
 * Its own module because `publicApplication.ts` is at 421 of its 500 lines.
 */
export function publicApplicationSmsRouter(): Router {
  const router = Router();

  /** What the card shows: the instrument as served, and where this applicant stands. */
  router.get(
    "/:token/sms-consent",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const invitation = await resolveInvitation(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(invitation)) {
        res.status(404).json(apiError(invitation.code, invitation.message));
        return;
      }
      const carrier = await carrierName(admin, invitation.org_id);
      const body: ApplicantSmsConsent = {
        document: composeSmsConsent(SMS_CONSENT, carrier),
        status: await smsConsentStatus(admin, invitation.org_id, invitation.driver_id),
      };
      res.json(body);
    }),
  );

  /**
   * Agree. Then one confirmation text (D-SMS5), through every gate `sendApplicationSms` holds —
   * so outside civil hours it is held, and the answer says so rather than claiming it went.
   */
  router.post(
    "/:token/sms-consent",
    validateBody(smsConsentGrantSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const now = new Date();
      const invitation = await resolveInvitation(admin, String(req.params.token ?? ""), now);
      if (isIntakeError(invitation)) {
        res.status(404).json(apiError(invitation.code, invitation.message));
        return;
      }
      const unconsented = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
      if (unconsented) {
        res.status(409).json(apiError(unconsented.code, unconsented.message));
        return;
      }

      const carrier = await carrierName(admin, invitation.org_id);
      const grant = res.locals.body as SmsConsentGrant;
      const result = await recordSmsConsent(
        admin, invitation.org_id, invitation.driver_id, grant.phone, carrier,
        { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
      );
      if ("code" in result) {
        const status = result.code === "invalid_phone" ? 400 : result.code === "sms_consent_not_final" ? 409 : 500;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }

      // Only a NEW consent is confirmed: a second press on the same number is the same agreement,
      // and a second confirmation text would be a message nobody asked for.
      let confirmation: SmsConfirmation = null;
      if (result.created) {
        const sent = await sendApplicationSms(
          admin, env, invitation.org_id, invitation.driver_id, smsOptInConfirmation(carrier), now,
        );
        confirmation = sent.sent ? "sent" : "held" in sent ? "held" : "failed";
      }
      res.status(result.created ? 201 : 200).json({
        ok: true,
        status: await smsConsentStatus(admin, invitation.org_id, invitation.driver_id),
        confirmation,
      });
    }),
  );

  /**
   * Stop, from the same card that said yes (D-SMS6). No ESIGN check and no draft check: withdrawing
   * must work in every state in which agreeing ever did, and in a few it never did.
   */
  router.post(
    "/:token/sms-consent/withdraw",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const invitation = await resolveInvitation(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(invitation)) {
        res.status(404).json(apiError(invitation.code, invitation.message));
        return;
      }
      await withdrawSmsConsent(
        admin, invitation.org_id, invitation.driver_id, "withdrawn by the applicant on the application page",
      );
      res.json({ ok: true, status: await smsConsentStatus(admin, invitation.org_id, invitation.driver_id) });
    }),
  );

  return router;
}
