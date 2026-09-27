import { z } from "zod";
import { formatDisplayDateTime } from "./displayDate.js";
import type { SmsHoldReason } from "./smsQuietHours.js";

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
 * The consent, as published on 2026-09-25 by the owner's ruling (SMS-OPT-IN-PLAN D-SMS10) and ahead
 * of counsel — the same call D-PR9 made for the privacy policy: carriers need a working opt-in to
 * verify the number, and a review has no date attached to it. Counsel's redline (memo Q12) lands as
 * the NEXT version, and because every `sms_consents` row stores the text and the version it was given
 * under, the swap is visible in the data rather than silent.
 *
 * ── WHERE EACH SENTENCE COMES FROM ────────────────────────────────────────────────────────────
 * Measured against three sources, 2026-09-25, and built from the strictest of each:
 *  - Telnyx's toll-free verification guide, whose transactional checkbox template is "By checking this
 *    box and submitting this form, you consent to receive transactional text messages for [use case]
 *    from [Company]. Reply STOP to opt out. Reply HELP for help. Standard message and data rates may
 *    apply. Message frequency may vary." Every clause of it is here, in the same order of weight.
 *  - CTIA Messaging Principles §5 (May 2023): name the sender, say what the messages are about, the
 *    frequency, the charges, and how to get help and stop.
 *  - 47 CFR §64.1200(f)(9)(i)(B): the signer must be told agreeing is not a condition of anything.
 *    For a job applicant the honest "purchase" is the job, so it names applying and being considered.
 * The two policy links are NOT inside this text: they sit beside it on the card (Telnyx: "View our
 * Terms… View our Privacy Policy"), because this body is stored on the row and a URL in stored
 * evidence is a promise about a page that will change.
 *
 * ── WHY "THE MOBILE NUMBER YOU ENTERED ABOVE" ─────────────────────────────────────────────────
 * Consent attaches to a number (0233). The sentence ties the agreement to the number typed beside it,
 * which is the number stored on the row — so the record reads as consent to THAT number, not to
 * whatever number the carrier later has on file.
 */
export const SMS_CONSENT: SmsConsentDocument = {
  version: "sms-2026-09-25",
  title: "Text message consent",
  citation: "47 U.S.C. §227; 47 CFR §64.1200",
  body:
    "By checking this box, you agree to receive text messages from {{carrier}} about your driver "
    + "application at the mobile number you entered above — for example, a link to your application "
    + "form, reminders about steps you have not finished, and updates on its status. These are not "
    + "marketing messages. Message frequency varies. Message and data rates may apply. Reply HELP "
    + "for help. Reply STOP at any time to opt out. Agreeing is optional: it is not a condition of "
    + "applying or of being considered for a job.",
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
 * The words that stop messages: CTIA's list, plus "revoke" and "opt out", which the FCC's 2024
 * revocation order names beside them for 47 CFR §64.1200(a)(10).
 *
 * ── TWO KINDS OF KEYWORD, AND WHY (G-2, C2d2) ─────────────────────────────────────────────────
 * Until 2026-09-26 every keyword was honoured anywhere in a message, and the plan's audit (G-2) named
 * the cost: "I'll quit my job Friday", "cancel Tuesday, I can come Wednesday" and "at the end of the
 * week" each revoked an applicant's consent in the middle of a conversation about their application.
 * Those three words are everyday English, so they now count only as the WHOLE message.
 *
 * The rest are not everyday English in a text to a recruiter, and they keep matching anywhere, because
 * the other side of the asymmetry has not moved: a missed opt-out costs $500 to $1,500 a message, the
 * FCC's standard is revocation "by any reasonable means", and "please stop texting me" is one by any
 * reading — the public terms page promises it works. A false positive is now recoverable where it was
 * not before: START lifts the suppression a STOP writes (`isStartMessage`).
 *
 * "The whole message" is read with case, punctuation and surrounding whitespace set aside — "Stop."
 * and "QUIT!" are the keyword; "quit smoking" is not.
 */
export const SMS_STOP_KEYWORDS = ["stop", "stopall", "unsubscribe", "revoke", "opt out", "optout", "cancel", "end", "quit"] as const;

/** Keywords honoured only as the whole message, because each is common in an ordinary reply (G-2). */
const WHOLE_MESSAGE_ONLY: readonly string[] = ["cancel", "end", "quit"];

/** Lower case, punctuation to spaces, whitespace collapsed — "  Opt-out! " reads as "opt out". */
const keywordText = (body: string | null | undefined): string =>
  (body ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function isStopMessage(body: string | null | undefined): boolean {
  const text = keywordText(body);
  if (text === "") return false;
  if ((SMS_STOP_KEYWORDS as readonly string[]).includes(text)) return true;
  // A word-boundary match, so "stopped by the yard" does not opt somebody out but "please stop" does.
  return SMS_STOP_KEYWORDS
    .filter((k) => !WHOLE_MESSAGE_ONLY.includes(k))
    .some((k) => new RegExp(`\\b${k}\\b`).test(text));
}

/**
 * The words that undo a STOP — CTIA's resubscribe keywords. The whole message only: "can I start
 * Monday" is a question about the job, not a request to be texted again.
 *
 * START lifts the suppression a STOP wrote and nothing more. The consents the STOP revoked stay revoked
 * (0233 makes a revocation final), so texts resume only once the applicant agrees again on their
 * application page — a START says "you may text this number", not what somebody agreed to.
 */
export const SMS_START_KEYWORDS = ["start", "unstop"] as const;

export function isStartMessage(body: string | null | undefined): boolean {
  return (SMS_START_KEYWORDS as readonly string[]).includes(keywordText(body));
}

/**
 * The answer to `HELP`, which US carriers require every A2P sender to give.
 *
 * ── WHY IT NAMES NO CARRIER ───────────────────────────────────────────────────────────────────
 * `STOP` resolves an org FROM the inbound number, because a revocation must land on the right
 * tenant's rows. `HELP` cannot do the same and must not try: somebody may text HELP with no consent
 * row at all — a wrong number, a forwarded message, a driver who applied months ago — and there is
 * then no org to name. Answering "we cannot identify you" to a mandated keyword is worse than
 * answering generically, and looking a stranger's number up across tenants to personalise a reply
 * would be the tenant leak every other unauthenticated surface in this product refuses.
 *
 * ── AND WHY IT IS SENT WHERE EVERY OTHER MESSAGE IS REFUSED ───────────────────────────────────
 * `sendApplicationSms` refuses without a live consent, outside civil hours, and while the wording is
 * draft. None of those apply here. A HELP reply is not a message we chose to send — it is the
 * required answer to a message somebody sent US, it carries no solicitation, and withholding it is
 * itself the carrier violation. So it goes out through the transport directly, and this comment is
 * the record of that being deliberate rather than an oversight.
 *
 * ── WHAT IT MUST CARRY ────────────────────────────────────────────────────────────────────────
 * CTIA §5 asks a HELP answer for the programme name and a way to reach customer care — a phone
 * number, an email or a web address. The web address is the SMS terms page, which carries the
 * support contact and every other disclosure, so the reply points somewhere that answers more than
 * a phone line would. The host is PASSED IN, from `WEB_APP_URL` on the API and the page's own host
 * on the web, rather than written here: a domain copied into a constant is a HELP reply that points
 * at the old site the day the domain changes.
 *
 * Kept under the 160-character GSM-7 limit so it is one message part and one charge — pinned by a
 * test at the production host.
 */
export const smsHelpReply = (siteHost: string): string =>
  `Silvicom 360 driver application texts. Help: ${siteHost}/sms-terms. `
  + "Msg & data rates may apply. Reply STOP to opt out.";

/** The host a HELP reply names, from a full URL like `WEB_APP_URL` — no scheme, no trailing slash. */
export const siteHostOf = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

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

/**
 * A number an applicant may agree to be texted on: a dialable US one (G-2, C2d2).
 *
 * `normalisePhone` stays permissive because it MATCHES — an inbound STOP must find its row whatever
 * shape it arrives in. Agreeing is the other direction and a narrower one: the programme is verified
 * for US toll-free sending, the quiet-hours window is computed for US zones, and a text to an
 * international number is the expensive kind of wrong number. NANP's own rule is applied too — an area
 * code or an exchange cannot start with 0 or 1 — so "(123) 456-7890" is refused as a typing mistake
 * rather than stored as consent to text nobody.
 */
export function normaliseUsPhone(raw: string | null | undefined): string | null {
  const e164 = normalisePhone(raw);
  return e164 && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164) ? e164 : null;
}

/**
 * How many different numbers one application link may agree to be texted on (G-2, C2d2). Each new
 * number is sent a confirmation text, so an uncapped link is a way to send a carrier's texts to any
 * number anybody types. Three covers a changed phone and a typo; a revoked number still counts, or
 * withdrawing and agreeing again would reset the count.
 */
export const SMS_MAX_NUMBERS_PER_LINK = 3;

/** `POST /api/public/application/:token/sms-consent` — the applicant agreeing, one act, no text. */
export const smsConsentGrantSchema = z.object({
  phone: z.string().min(7).max(40),
  /** ESIGN-style affirmation, on the instrument itself and never inherited. */
  agreed: z.literal(true),
});
export type SmsConsentGrant = z.infer<typeof smsConsentGrantSchema>;

/**
 * Where one applicant stands on texts, as both the applicant's card and the office's panel read it
 * (SMS-OPT-IN-PLAN D-SMS1, D-SMS6).
 *
 * `stopped` is "the newest consent was revoked" — by a STOP, by the applicant's own control, or by
 * the office recording a request made some other way. It is kept apart from `none` because the
 * office's next move differs: `none` may be asked, `stopped` may not be asked again by us.
 *
 * ⚠ The last four digits and never the number (D-SMS3). The applicant's copy is read on an
 * unauthenticated link, and the office already holds the number on the driver row.
 */
export const SMS_CONSENT_STATES = ["agreed", "stopped", "none"] as const;
export type SmsConsentState = (typeof SMS_CONSENT_STATES)[number];

export interface SmsConsentStatus {
  /** False while `SMS_CONSENT` is draft: nothing may be asked, and the card is not shown (D-SMS8). */
  offered: boolean;
  state: SmsConsentState;
  phoneLast4: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
}

/** `GET /api/public/application/:token/sms-consent` — the card's whole input. */
export interface ApplicantSmsConsent {
  /** The instrument as served, carrier named — shown in full beside the box, never summarised. */
  document: SmsConsentDocument;
  status: SmsConsentStatus;
}

/** What became of the one confirmation text an opt-in sends (D-SMS5). `null` when none was due. */
export type SmsConfirmation = "sent" | "held" | "failed" | null;

/**
 * The opt-in confirmation (D-SMS5), carrying the five things CTIA §5.1.2.1 asks of one: the
 * programme, customer care (HELP), how to opt out, the frequency, and the charges.
 *
 * Kept inside one 160-character GSM-7 part for a carrier name of ordinary length, so it is one
 * message and one charge — pinned by a test at "Silvicom Inc". "You're" rather than "You are" is
 * that budget, not a change of voice; the apostrophe is plain ASCII, which GSM-7 carries.
 */
export const smsOptInConfirmation = (carrier: string): string =>
  `${carrier}: You're signed up for texts about your driver application. Msg frequency varies. `
  + "Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

/**
 * The application link, by text (D-SMS7).
 *
 * Carrier name first (every US programme requires the sender in the body) and STOP last. It says the
 * older link has stopped working because it has: sending rotates the token, and a driver holding the
 * permissions link would otherwise tap the dead one. No link shortener — carriers block public
 * shorteners on sight — so the full link, which is on the sender's own verified domain.
 */
export const smsApplicationReady = (carrier: string, link: string): string =>
  `${carrier}: Your driver application is ready. Fill it in here: ${link} `
  + "Your earlier link no longer works. Reply STOP to opt out.";

/**
 * The applicant's own link, to their phone, from their own desktop page (§6.6.6, C3b2b2).
 *
 * ⚠ No "your earlier link no longer works": unlike the two above, this rotates nothing — it is the
 * very link open on the desktop, so the driver finishes on whichever screen they like.
 */
export const smsApplicationPhoneLink = (carrier: string, link: string): string =>
  `${carrier}: Here is your driver application link, to take the photos on your phone: ${link} `
  + "Reply STOP to opt out.";

/**
 * What "Text me the link" answered (§6.6.6). `held` names why nothing went, so the page can say
 * what to do instead — quiet hours is "use the QR code", not "try again".
 */
export type TextLinkAnswer =
  | { outcome: "sent" }
  | { outcome: "held"; held: SmsHoldReason };

/** The 48-hour reminder (A10) — the same link rotation as above, so the same warning. */
export const smsApplicationReminder = (carrier: string, link: string): string =>
  `${carrier}: Your driver application is saved. Pick up where you left off: ${link} `
  + "This link replaces any earlier one. Reply STOP to opt out.";

/**
 * The approval notice (F4). No link, deliberately: since AF5 there is nothing to do on the
 * application link until the office opens signing in person (D-AF3).
 */
export const smsApplicationApproved = (carrier: string): string =>
  `${carrier}: Your driver application has been approved. We will contact you to arrange a visit `
  + "to our office to sign it. Reply STOP to opt out.";

/** What the office wrote down about the drug-test appointment (D-AW6), as the text reads it. */
export interface DrugTestSiteParams {
  site_name: string;
  site_address: string;
  site_phone: string | null;
  window_start: string;
  window_end: string | null;
  donor_reference: string | null;
}

/**
 * The drug-test appointment, by text (D-AW6, C2d) — where to go, when, and what to quote.
 *
 * ⚠ No link, on purpose: a text carrying a link cannot wait in `sms_outbox` (0376 refuses a URL in
 * its params, and plan Q-AW29 holds the link-bearing sends), and this one often has to wait — the
 * office books collections during the day, for tomorrow. The times are the carrier's clock, which is
 * what the office typed them on (`carrierWallTimeSchema`), and they say so.
 */
export function smsDrugTestSite(carrier: string, p: DrugTestSiteParams, zone: string, zoneLabel: string): string {
  const from = formatDisplayDateTime(p.window_start, "", zone);
  const until = p.window_end ? ` to ${formatDisplayDateTime(p.window_end, "", zone).split(" ").slice(1).join(" ")}` : "";
  return [
    `${carrier}: Your drug test is at ${p.site_name}, ${p.site_address}, ${from}${until} ${zoneLabel}.`,
    p.site_phone ? `Site phone ${p.site_phone}.` : "",
    p.donor_reference ? `Give them reference ${p.donor_reference}.` : "",
    // §40.61(c): the collector must see the donor's photo ID before the test starts.
    "Bring your photo ID. Reply STOP to opt out.",
  ].filter(Boolean).join(" ");
}
