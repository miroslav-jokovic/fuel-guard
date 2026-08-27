import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ESIGN_CONSENT,
  esignConsentBody,
  isDraftDisclosure,
} from "@silvicom/shared";
import {
  isIntakeError,
  resolveInvitation,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";

/**
 * Consent to transact electronically — the first act on the link (A4, D-APP5).
 *
 * 49 CFR §390.32(d) requires an electronic record satisfying a Part 300–399 document requirement to
 * "include proof of consent per 15 U.S.C. 7001(c)". §391.21 is such a requirement, so without this
 * the application a driver fills in on their phone is not the document the regulation asked for.
 *
 * ── THE GATE IS ARMED BY A0, NOT BY THIS STEP ─────────────────────────────────────────────────
 * D-APP5 says nothing else on the link is reachable until a consent exists. Enforcing that
 * unconditionally today would take the application offline in production, because
 * `ESIGN_CONSENT.version` is `v0-draft` and this service will not put a person's consent under text
 * no lawyer has read — so the gate would refuse every write with no way through it.
 *
 * So the requirement is tied to the same hazard the signing gate is tied to: while the wording is
 * draft, the link behaves exactly as it did before A4 and no consent is asked for; the moment A0
 * publishes the reviewed text, the gate closes by itself on every write path. That is `DISCLOSURES`'
 * own argument — a flag would have to be remembered, and what would need remembering is "start
 * requiring the consent the regulation requires". Both branches are proved by tests, the closed one
 * against a stubbed non-draft document.
 */

/** Is the 7001(c) consent collectable — i.e. has counsel's text been published (A0)? */
export const esignConsentIsPublishable = (): boolean => !isDraftDisclosure(ESIGN_CONSENT.version);

export const CONSENT_ALREADY_GIVEN: IntakeError = {
  code: "esign_consent_already_given",
  message: "You have already agreed to sign these documents electronically.",
};

/** What the applicant's page renders before anything else — served, never shipped in the bundle. */
export function esignConsentForApplicant(): {
  version: string;
  title: string;
  citation: string;
  body: string;
  intent: string;
  draft: boolean;
  /** False while the wording is draft: the page must not ask for a consent that cannot be recorded. */
  required: boolean;
} {
  return {
    version: ESIGN_CONSENT.version,
    title: ESIGN_CONSENT.title,
    citation: ESIGN_CONSENT.citation,
    body: esignConsentBody(),
    intent: ESIGN_CONSENT.intent,
    draft: isDraftDisclosure(ESIGN_CONSENT.version),
    required: esignConsentIsPublishable(),
  };
}

/**
 * Record it.
 *
 * The version, the text and the intent are all composed HERE from `ESIGN_CONSENT` — the request
 * carries who consented and from where, never what they consented to. A client-authored record of
 * consent is worth nothing in the audit it exists for, which is the rule 0092 set and 0215 repeated.
 */
export async function recordEsignConsent(
  admin: SupabaseClient,
  token: string,
  ctx: SubmitContext,
  now: Date,
): Promise<{ consentId: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  // The same refusal the signing endpoint gives, for the same reason: this is a signed instrument,
  // and a consent recorded against placeholder wording is evidence of nothing.
  if (isDraftDisclosure(ESIGN_CONSENT.version)) {
    return {
      code: "disclosure_not_final",
      message:
        "This carrier has not published its final wording yet. Nothing here can be signed until "
        + "they do, and they have been told.",
    };
  }
  if (invitation.consented_at) return CONSENT_ALREADY_GIVEN;

  const { data, error } = await admin.rpc("record_esign_consent", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_version: ESIGN_CONSENT.version,
    p_text: esignConsentBody(),
    p_intent: ESIGN_CONSENT.intent,
    p_ip: ctx.ip,
    p_user_agent: ctx.userAgent,
  });
  if (error) {
    // EC022 is the race the FOR UPDATE lock caught — two taps, or two tabs.
    if (error.code === "EC022" || /already_given/.test(error.message)) return CONSENT_ALREADY_GIVEN;
    if (
      error.code === "EC020"
      || error.code === "EC021"
      || /invitation_unusable|invitation_not_found/.test(error.message)
    ) {
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    }
    return { code: "consent_failed", message: error.message };
  }
  return { consentId: String((data as { consent_id?: string } | null)?.consent_id ?? "") };
}
