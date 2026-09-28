import { Router } from "express";
import {
  SMS_CONSENT,
  composeSmsConsent,
  smsApplicationPhoneLink,
  smsConsentGrantSchema,
  type ApplicantSmsConsent,
  type SmsConfirmation,
  type SmsConsentGrant,
  type TextLinkAnswer,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { textLinkLimiter } from "../../../middleware/applicationLimits.js";
import { isIntakeError, requireEsignConsent, resolveInvitation } from "../applicationIntake.js";
import { carrierName } from "../applicationMail.js";
import { loadCarrierWording } from "../carrierWording.js";
import {
  recordSmsConsent,
  sendApplicationSms,
  smsConsentStatus,
  withdrawSmsConsent,
} from "../applicationSms.js";
import { sendOrQueueSms } from "../smsOutbox.js";

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
        admin, invitation, grant.phone, carrier,
        { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
      );
      if ("code" in result) {
        const status = result.code === "invalid_phone" ? 400 : result.code === "consent_failed" ? 500 : 409;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }

      // Only a NEW consent is confirmed: a second press on the same number is the same agreement,
      // and a second confirmation text would be a message nobody asked for.
      let confirmation: SmsConfirmation = null;
      if (result.created) {
        // Through the outbox (C2d): an opt-in pressed at 22:00 is confirmed at the applicant's morning
        // rather than never (A-11). `held` now means queued for that morning, which is what it says.
        const sent = await sendOrQueueSms(admin, env, {
          orgId: invitation.org_id, driverId: invitation.driver_id, invitationId: invitation.id,
          template: "consent_confirm", params: {},
        }, now);
        confirmation = sent.sent ? "sent" : "queued" in sent || "held" in sent ? "held" : "failed";
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

  /**
   * "Text me the link" (§6.6.6, C3b2b2) — the desktop page sending ITS OWN link to the phone the
   * applicant agreed to be texted on, so the photographs are taken with a camera.
   *
   * ⚠ **Send now or never, never through `sms_outbox`** — and since Q-AW29 that is a choice, not a
   * limit: the outbox could hold it now (the text would carry its own token, 0378), but this text is
   * for a person sitting at the desktop THIS minute, and a link that arrived in the morning would be
   * the wrong answer to the question they asked. So `sendApplicationSms` directly — every gate it
   * holds (draft wording, a live consent, a number, a suppression, quiet hours) answers `held`, and
   * the page says what to do instead ("use the QR code").
   *
   * ⚠ **The link is composed here from this request's own `:token`, and stored nowhere.** The client
   * sends no URL and no number: a body the server texted would be a way to text anything to anybody.
   * Nothing is rotated — it is the link already open on the desktop.
   *
   * The zone is the strict all-US window (`timeZone` null): Part 1 asks for the address after the
   * photographs, so on these screens there is usually none to read, and `sendApplicationSms` takes one
   * zone where C2d1's split-state rule needs several. The strict window is never wrong, only narrower.
   */
  router.post(
    "/:token/text-link",
    textLinkLimiter(),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const now = new Date();
      const token = String(req.params.token ?? "");
      const invitation = await resolveInvitation(admin, token, now);
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
      const link = `${env.WEB_APP_URL}/apply/${encodeURIComponent(token)}`;
      const sent = await sendApplicationSms(
        admin, env, invitation.org_id, invitation.driver_id, smsApplicationPhoneLink(carrier, link), now,
      );
      if ("failed" in sent) {
        res.status(502).json(apiError("sms_failed", "The text did not go. Use the QR code instead."));
        return;
      }
      const body: TextLinkAnswer = sent.sent ? { outcome: "sent" } : { outcome: "held", held: sent.held };
      res.json(body);
    }),
  );

  return router;
}
