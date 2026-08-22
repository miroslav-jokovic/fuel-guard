import { z } from "zod";

/**
 * Consent to be texted (A11b, D-APP13).
 *
 * ── SMS IS NOT A DELIVERY MECHANISM, IT IS A CONSENT REGIME ───────────────────────────────────
 * That is D-APP13's sentence and it is why this file exists at all. Email needed no table; a text
 * needs a signed instrument, a version, an audit trail and an opt-out that works, because the TCPA
 * assesses $500 to $1,500 PER MESSAGE and the only defence is the record of what somebody agreed to.
 *
 * ── ⚠ WHAT THE REGULATION ACTUALLY GOVERNS, SAID PRECISELY ────────────────────────────────────
 * 47 CFR §64.1200(f)(9)'s "prior express written consent" — signature, plus a disclosure that the
 * signer is not required to agree as a condition of anything — is defined for "advertisements or
 * telemarketing messages". A message to somebody about their OWN in-progress job application is a
 * weaker case for that classification than a marketing blast, and a reasonable lawyer might call it
 * transactional and outside it entirely.
 *
 * We collect the full written consent anyway, and the asymmetry is the whole argument: being
 * conservative costs one checkbox on a form, and being wrong costs per message. **Which classification
 * applies is counsel's call and not an engineer's** — the same division this plan applies to every
 * other instrument (A0), and the reason the text below carries a version rather than being inlined.
 */

/** Where a consent was taken. `application` is the only source today; R1's lead form adds its own. */
export const SMS_CONSENT_SOURCES = ["application", "lead_form", "office"] as const;
export type SmsConsentSource = (typeof SMS_CONSENT_SOURCES)[number];

export interface SmsConsentDocument {
  version: string;
  title: string;
  citation: string;
  /** Shown ALONE, beside its own control — never bundled with another agreement (§604(b)(2)'s rule,
   *  applied here for the same reason D-HIRE3 applies it to the five instruments). */
  body: string;
  /** The sentence the signer affirms. */
  intent: string;
}

/**
 * ⚠ PLACEHOLDER TEXT, marked as such exactly like `DISCLOSURES` (Q-H3, A0).
 *
 * `v0-draft` is deliberately not `v1`: the version is stored on every consent row, so a later swap to
 * counsel's wording is visible in the data rather than silent, and the gate below refuses to record a
 * signature under text no lawyer has read. The clauses are the ones §64.1200(f)(9) enumerates, each
 * present so counsel's pass is a review of named sentences rather than a blank page.
 */
export const SMS_CONSENT: SmsConsentDocument = {
  version: "v0-draft",
  title: "Text message consent",
  citation: "47 U.S.C. §227; 47 CFR §64.1200(f)(9)",
  body:
    "PLACEHOLDER — pending counsel. By agreeing, you allow {{carrier}} to send you text messages "
    + "about your driver application, including a link back to the application you have started. "
    + "Message frequency is limited to messages about your own application. Message and data rates "
    + "may apply. You are NOT required to agree to this in order to apply for a position, and "
    + "agreeing is not a condition of being considered. Reply STOP at any time to stop receiving "
    + "texts; reply HELP for help.",
  intent: "I agree to receive text messages from {{carrier}} about my application.",
};

/** True while the wording is still draft — nothing may be recorded against it. */
export const isDraftSmsConsent = (doc: SmsConsentDocument = SMS_CONSENT): boolean =>
  doc.version.endsWith("-draft") || doc.version.startsWith("v0");

/**
 * The consent as served, with the carrier's name filled in.
 *
 * Composed SERVER-side like every other instrument in this product: the request carries the act, never
 * the text, because a client-authored record of what somebody agreed to is worth nothing in the
 * proceeding it exists for.
 */
export const composeSmsConsent = (doc: SmsConsentDocument, carrier: string): SmsConsentDocument => ({
  ...doc,
  body: doc.body.replaceAll("{{carrier}}", carrier),
  intent: doc.intent.replaceAll("{{carrier}}", carrier),
});

/**
 * The words that stop messages, per CTIA's messaging principles and every US carrier's implementation.
 *
 * Matched case-insensitively on the whole trimmed body: a message reading "stop texting me" is not an
 * opt-out keyword by the letter of the spec, and is unmistakably an opt-out by any human reading —
 * so `STOP` alone is honoured as the keyword, and anything CONTAINING a keyword is honoured too. The
 * asymmetry is deliberate: honouring a non-keyword costs a message nobody wanted to send, and missing
 * a real one costs $500 to $1,500 and a complaint.
 */
export const SMS_STOP_KEYWORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"] as const;

export function isStopMessage(body: string | null | undefined): boolean {
  const text = (body ?? "").trim().toLowerCase();
  if (text === "") return false;
  if ((SMS_STOP_KEYWORDS as readonly string[]).includes(text)) return true;
  // A word-boundary match, so "stopped by the yard" does not opt somebody out but "please stop" does.
  return SMS_STOP_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(text));
}

/** `HELP` is required to be answered by the same carrier rules that require `STOP`. */
export function isHelpMessage(body: string | null | undefined): boolean {
  const text = (body ?? "").trim().toLowerCase();
  return text === "help" || text === "info";
}

/**
 * E.164 for storage and for matching an inbound number to a consent row.
 *
 * Digits only, US-defaulted: every number this product holds was typed by an American recruiter into
 * a form, and a stored `(708) 236-5732` that cannot be matched to an inbound `+17082365732` is a
 * `STOP` that silently does nothing — which is the one failure this normalisation exists to prevent.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Anything else is returned only if it already looks like E.164; a guess here would be a wrong
  // number, and a text to a wrong number is the expensive kind of mistake.
  return /^\+[1-9]\d{7,14}$/.test((raw ?? "").trim()) ? (raw ?? "").trim() : null;
}

/** `POST /api/public/application/:token/sms-consent` — the applicant agreeing, one act, no text. */
export const smsConsentGrantSchema = z.object({
  phone: z.string().min(7).max(40),
  /** ESIGN-style affirmation, on the instrument itself and never inherited. */
  agreed: z.literal(true),
});
export type SmsConsentGrant = z.infer<typeof smsConsentGrantSchema>;
