import { z } from "zod";
import { driverApplicationSchema, type ApplicationEmployer, type DriverApplication } from "./applicationContract.js";
import {
  AUTHORIZATION_PURPOSES,
  DISCLOSURES,
  ESIGN_CONSENT,
  isDraftDisclosure as isDraft,
  type AuthorizationPurpose,
} from "./authorizationContract.js";

/**
 * The applicant-facing intake — invitation, submission, and what a submission becomes (H5).
 *
 * ── THE INVITATION IS A CREDENTIAL ─────────────────────────────────────────────────────────────
 * The link is the only thing between an anonymous request and a form that accepts a date of birth
 * and a Social Security number, so it is generated with 256 bits of entropy, stored only as a
 * SHA-256, spent on first successful submission, and expires. `invites.token` (0033) is the
 * counter-example this deliberately does not follow: it is stored in plaintext and never presented,
 * which is safe only because it is inert.
 *
 * ── WHY THE TTL IS SHORT BY DEFAULT AND BOUNDED ABSOLUTELY ─────────────────────────────────────
 * A hiring conversation is days, not months. Fourteen days covers "I'll do it this weekend" twice
 * over; the 60-day ceiling exists because an invitation that outlives the vacancy is a live
 * credential nobody is thinking about any more.
 */

export const INVITE_TTL_DAYS_DEFAULT = 14;
export const INVITE_TTL_DAYS_MAX = 60;

export const applicationInviteCreateSchema = z.object({
  driver_id: z.uuid(),
  /** Where the link is being sent, recorded so a recruiter can see who was invited. */
  email: z.email().max(200).nullish(),
  expires_in_days: z.coerce.number().int().min(1).max(INVITE_TTL_DAYS_MAX).default(INVITE_TTL_DAYS_DEFAULT),
});
export type ApplicationInviteCreate = z.infer<typeof applicationInviteCreateSchema>;

/**
 * §391.21(b)(2) requires the Social Security number on the application (D-HIRE6).
 *
 * Nine digits, and nothing clever: no formatting accepted, because a value that arrives three ways
 * is a value stored three ways, and this is the one field in the product where a duplicate in the
 * wrong format is a second copy of the worst thing we hold. Optional in the schema — a carrier whose
 * MVR vendor accepts the last four should be able to collect nothing more, and that has to be the
 * easy configuration rather than a discipline somebody remembers.
 */
export const ssnSchema = z.string().regex(/^\d{9}$/, "A Social Security number is nine digits");

/** The four digits that may be stored in the clear. Everything else is sealed or discarded. */
export const ssnLast4 = (ssn: string): string => ssn.slice(-4);

export const applicationSubmitSchema = z.object({
  application: driverApplicationSchema,
  ssn: ssnSchema.nullish(),
});
export type ApplicationSubmit = z.infer<typeof applicationSubmitSchema>;

/**
 * One release, signed by the applicant.
 *
 * A separate call per instrument, which is D-HIRE3 expressed in the transport: FCRA §604(b)(2)
 * requires the disclosure to be "in a document that consists SOLELY of the disclosure", and a
 * request body carrying four consents at once is one document carrying four consents. The applicant
 * sees one, signs one, sends one.
 */
export const applicationReleaseSchema = z.object({
  purpose: z.enum(AUTHORIZATION_PURPOSES),
  signed_name: z.string().min(1).max(200),
  /** ESIGN intent, affirmed on the instrument itself — not inherited from the application. */
  esign_consent: z.literal(true),
});
export type ApplicationRelease = z.infer<typeof applicationReleaseSchema>;

/**
 * ── THE SAVED DRAFT (A2, D-APP2) ──────────────────────────────────────────────────────────────
 *
 * A partial, unvalidated snapshot of the form. Deliberately NOT `driverApplicationSchema.partial()`:
 * a draft holds half-typed strings — a `date_of_birth` that is currently `"198"` — and running the
 * regulated schema over them would refuse to save exactly the states worth saving. The contract is
 * applied at submit, where the applicant certifies the answers as true and complete.
 */
export const DRAFT_PAYLOAD_MAX_BYTES = 128 * 1024;

/**
 * The one key a draft may never carry (D-APP3).
 *
 * §391.21(b)(2)'s Social Security number is collected in the final step and travels straight into
 * `sealSsn` at submit. `application_drafts.payload` is plain jsonb in a prunable table; nine digits
 * do not go in it, ever. This is a REFUSAL and not a filter: the client never places the key in the
 * draft object at all (`toDraftPayload`, pinned by a test), so a payload that carries one is a
 * client regression, and the only useful response to a client regression is a loud one.
 */
export const applicationDraftSaveSchema = z.object({
  payload: z
    .record(z.string(), z.unknown())
    .refine((p) => !("ssn" in p), { message: "A draft may not carry a Social Security number" }),
  /** The furthest section reached. A3 defines the vocabulary; until then this is free text. */
  section: z.string().min(1).max(64).nullish(),
});
export type ApplicationDraftSave = z.infer<typeof applicationDraftSaveSchema>;

/**
 * Releasing a saved draft to the person who typed it (D-APP16).
 *
 * The link is a session now and A10 re-sends it in a nudge email, so a forwarded email or a shared
 * phone would otherwise read a half-typed application. One low-friction check closes it: the date of
 * birth, which is among the first things the form asks, which the driver always knows, and which is
 * precisely the field whose exposure the gate exists to prevent. A second factor would be security
 * theatre bought with abandonment.
 */
export const applicationDraftUnlockSchema = z.object({
  date_of_birth: z.string().min(1).max(32),
});
export type ApplicationDraftUnlock = z.infer<typeof applicationDraftUnlockSchema>;

/**
 * The date of birth a draft is currently carrying, if any — trimmed, or null.
 *
 * Reads the payload structurally rather than trusting a type: the draft is unvalidated by design, so
 * `date_of_birth` may be absent, empty, half-typed or not a string at all, and every one of those
 * means "no date of birth has been typed yet".
 */
export function draftDateOfBirth(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).date_of_birth;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Is this draft's body gated?
 *
 * Before a date of birth is typed there is nothing sensitive to protect, so no gate is shown — the
 * driver who is one field into the form is not asked to prove who they are. The gate appears exactly
 * when the thing it protects does.
 */
export const draftIsLocked = (payload: unknown): boolean => draftDateOfBirth(payload) !== null;

/**
 * Is this disclosure wording still a draft?
 *
 * ⚠ Moved to `authorizationContract.ts` in A4 and re-exported here, so the callers that have always
 * imported it from this module keep working. There were two predicates — this one
 * (`startsWith("v0")`, the enforcement path) and `disclosuresAreDraft` (`endsWith("-draft")`, what
 * the UI reads) — agreeing on every string in use and diverging on the first careless one:
 * `"v1-draft"` would have been enforced as final and displayed as draft. The union of both now lives
 * beside the documents it judges. A0's checklist item for this is done.
 */
export { isDraftDisclosure } from "./authorizationContract.js";

/** Purposes an applicant is asked to sign, in the order they are presented. */
export const APPLICATION_RELEASE_ORDER: readonly AuthorizationPurpose[] = [
  "fcra_disclosure",
  "psp",
  "previous_employer",
  "drug_alcohol",
];

/**
 * Is any wording the APPLICANT'S PATH depends on still unreviewed? (2026-08-23.)
 *
 * ── WHY THIS IS NOT `disclosuresAreDraft()` ───────────────────────────────────────────────────
 * That predicate judges the whole catalogue, and the catalogue contains one instrument no applicant
 * is ever asked to sign: `clearinghouse`. §382.701(a)'s full-query consent is given inside the FMCSA
 * Clearinghouse, not on our screen — it is deliberately absent from `APPLICATION_RELEASE_ORDER` and
 * belongs to a safety_manager workflow (D-REC4, R5). Gating the applicant's submission on it would
 * make the driver's path wait on a document the driver has nothing to do with.
 *
 * So the scope is exactly the six things that path touches: the 7001(c) consent that makes the
 * electronic record a record at all, and the four releases the ceremony collects.
 *
 * ⚠ **It lives here rather than beside `DISCLOSURES` because of the direction of the imports.**
 * `APPLICATION_RELEASE_ORDER` is application vocabulary; `authorizationContract.ts` knows nothing
 * about applications and must keep not knowing, or the catalogue starts depending on one of its
 * consumers.
 */
export const applicationWordingIsDraft = (): boolean =>
  isDraft(ESIGN_CONSENT.version)
  || APPLICATION_RELEASE_ORDER.some((p) => isDraft(DISCLOSURES[p].version));

// ── what a submission becomes ─────────────────────────────────────────────────

/** The `drivers` columns the application can fill. Applied with coalesce — never overwriting. */
export interface ApplicationDriverPatch {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  cdl_number: string;
  cdl_state: string;
  /**
   * §391.23(a)(2). The names a previous employer would have known this driver by — projected onto
   * `drivers` because the previous-employer inquiry is composed from there, and a maiden name that
   * stayed in the application payload would be a fact we hold and never use.
   */
  other_names: string[];
}

export interface ApplicationEmploymentRow {
  employer_name: string;
  usdot_number: string | null;
  /** §391.23(c)(2) requires the previous employer's name AND address in the record of the inquiry. */
  employer_address_line1: string | null;
  employer_city: string | null;
  employer_state: string | null;
  employer_phone: string | null;
  employer_email: string | null;
  position_held: string | null;
  started_on: string;
  ended_on: string | null;
  dot_regulated: boolean;
  operated_cmv: boolean;
  reason_for_leaving: string | null;
  /**
   * §40.25(j)'s two questions, carried across rather than left in the payload. They decide what a
   * previous-employer inquiry must ASK — a job that was not safety-sensitive owes no drug-and-alcohol
   * history — so they belong on the row the inquiry is chased from, not only in the document.
   */
  subject_to_fmcsr: boolean | null;
  safety_sensitive: boolean | null;
}

const employmentRow = (e: ApplicationEmployer): ApplicationEmploymentRow => ({
  employer_name: e.employer_name,
  usdot_number: e.usdot_number ?? null,
  // The contract names these for the FORM the applicant fills in; the table names them for the
  // employer they describe. Mapped once, here, rather than by a column rename that would break the
  // §391.21(b) field labels a driver reads.
  employer_address_line1: e.address_line1 ?? null,
  employer_city: e.city ?? null,
  employer_state: e.state ?? null,
  employer_phone: e.phone ?? null,
  employer_email: e.email ?? null,
  position_held: e.position_held ?? null,
  started_on: e.started_on,
  ended_on: e.ended_on ?? null,
  dot_regulated: e.dot_regulated,
  operated_cmv: e.operated_cmv,
  reason_for_leaving: e.reason_for_leaving ?? null,
  subject_to_fmcsr: e.subject_to_fmcsr ?? null,
  safety_sensitive: e.safety_sensitive ?? null,
});

/**
 * Project a certified application into the rows the rest of the product reads.
 *
 * ── EVERY DECLARED EMPLOYER BECOMES A ROW, INCLUDING THE ONES OUTSIDE BOTH WINDOWS ─────────────
 * `employmentSegments` decides what the applicant was REQUIRED to list. This decides what they DID
 * list, and the two are not the same question. Dropping an employer because it fell outside
 * §391.21(b)(10)-(11) would delete part of a document somebody certified as true and complete, and
 * would also throw away the corroboration the PSP cross-match needs — an inspection under a carrier
 * the applicant mentioned voluntarily still corroborates.
 *
 * The application row keeps the document whole regardless; this is about what becomes queryable.
 */
export function planApplicationIntake(application: DriverApplication): {
  driverPatch: ApplicationDriverPatch;
  employment: ApplicationEmploymentRow[];
} {
  return {
    driverPatch: {
      first_name: application.first_name,
      last_name: application.last_name,
      date_of_birth: application.date_of_birth as string,
      cdl_number: application.cdl_number,
      cdl_state: application.cdl_state,
      other_names: application.other_names ?? [],
    },
    employment: application.employers.map(employmentRow),
  };
}
