import { z } from "zod";
import { dateOfBirthSchema, isoDateSchema } from "./rosterContract.js";
import { usdotNumberSchema } from "./recruitmentContract.js";
import { EMPLOYMENT_WINDOW_YEARS, CMV_WINDOW_YEARS, yearsBefore } from "./employmentCoverage.js";

/**
 * The driver's employment application — 49 CFR §391.21(b), as a contract.
 *
 * ONE SOURCE OF TRUTH for what the applicant is asked and what counts as a complete answer. The
 * regulation enumerates TWELVE items and this file follows that numbering deliberately, so a reader
 * with the CFR open can check us line by line. Re-read verbatim 2026-08-21 (Cornell LII, current
 * text; Part 391's most recent amendment is 87 FR 13208, 2022-03-09), not recalled — and the read
 * corrected three things this file and APPLICATION-SYSTEM-PLAN's A3 had wrong. They are written out
 * here because the whole value of the numbering is that it can be checked:
 *
 *   (b)(1)  "The name and address of the employing motor carrier" — NOT an applicant field and not
 *           in this schema. It is a fact about the carrier, and D-APP9's rule (the server composes
 *           what the server knows) puts it in the rendered document, not in the request body. ⚠ It
 *           is currently satisfied NOWHERE: `organizations` carries a name and a dot_number and no
 *           address at all, so A6's renderer cannot print one. Raised in the plan's §6.
 *   (b)(4)  "The date on which the application is submitted" — satisfied by
 *           `driver_applications.certified_at`, stamped server-side. It must NEVER become a field
 *           here: D-APP9 forbids accepting any date of signing or submission from a client.
 *   (b)(5)  "The issuing driver's licensing authority, number, and expiration date of EACH unexpired
 *           commercial motor vehicle operator's license or permit that has been issued to the
 *           applicant". Note "each": the regulation asks for a LIST, and this schema carried exactly
 *           one licence until A3 added `additional_licences`. Note also "issuing driver's licensing
 *           authority" rather than "issuing State" — the 2022 text admits an authority that is not
 *           a US state, which is why the additional entries take free text while `cdl_state` stays a
 *           state code (PSP and SambaSafety both match on one).
 *
 * ── WHY THIS IS NOT THE SAME THING AS THE DQF's `employment_application` ────────────────────────
 * DQF's item asks "is there an application on file" — a one-time §391.51(b)(1) requirement satisfied
 * by a document. This is the application's CONTENTS, captured from the applicant before there is a
 * file at all. Recruitment produces; DQF files (HIRING-PLAN.md D-HIRE2). The handoff is H8.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────────────────────────
 * The releases. §391.21(b) is a form the applicant certifies; the FCRA/PSP/§40.25(g)/Clearinghouse
 * authorizations are SEPARATE documents, because §604(b)(2) requires the disclosure to consist
 * solely of the disclosure and courts read `solely` literally (D-HIRE3). They live in
 * `authorizationContract.ts` and there is no field here to smuggle one into.
 */

// ── (b)(3) residence history ──────────────────────────────────────────────────

export const applicationAddressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullish(),
  city: z.string().min(1).max(120),
  state: z.string().min(2).max(40),
  postal_code: z.string().min(3).max(20),
  from: z.string().regex(/^\d{4}-\d{2}$/, "Expected a month as YYYY-MM"),
  /** null = current address. */
  to: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().regex(/^\d{4}-\d{2}$/, "Expected a month as YYYY-MM").nullish(),
  ),
  // `.strict()` like the parent (A3). The 2026-08-21 audit found the four nested schemas silently
  // accepting unknown keys while the top level refused them — so a client could smuggle a field into
  // the certified payload through any array on the form, which is precisely the hole `.strict()`
  // exists to close and precisely where nobody was looking.
}).strict();
export type ApplicationAddress = z.infer<typeof applicationAddressSchema>;

// ── (b)(10)/(b)(11) employment history ────────────────────────────────────────

/**
 * One declared employer. `operated_cmv` is what sorts an entry into (b)(11), and it is asked of every
 * entry rather than only the old ones — the applicant knows the answer and the boundary is ours to
 * compute, not theirs to remember.
 */
export const applicationEmployerSchema = z
  .object({
    employer_name: z.string().min(1).max(200),
    usdot_number: usdotNumberSchema,
    address_line1: z.string().max(200).nullish(),
    city: z.string().max(120).nullish(),
    state: z.string().max(40).nullish(),
    phone: z.string().max(40).nullish(),
    /**
     * Where a §391.23(a)(2) inquiry is sent. Optional, because an applicant may genuinely not know
     * it and a required field they cannot answer is a form they abandon — the office can add one
     * later, and a posted letter is an equally good contact under §391.23(c)(2).
     */
    email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
    position_held: z.string().max(120).nullish(),
    started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
    ended_on: isoDateSchema,
    /** §391.21(b)(11) — did the applicant operate a commercial motor vehicle in this job? */
    operated_cmv: z.boolean(),
    /** §391.23(a)(2): only a DOT-regulated employer owes a safety-performance inquiry. */
    dot_regulated: z.boolean(),
    /** §391.21(b)(10) asks for it in as many words. */
    reason_for_leaving: z.string().max(500).nullish(),
    /**
     * §40.25(j): the applicant must be asked whether they have EVER tested positive or refused a
     * test and then failed to complete return-to-duty. Asked here because the answer is the
     * applicant's, not a former employer's — and a "yes" changes what §40.25 obliges us to chase.
     */
    subject_to_fmcsr: z.boolean().nullish(),
    safety_sensitive: z.boolean().nullish(),
  })
  .strict()
  .refine((v) => typeof v.ended_on !== "string" || v.ended_on >= v.started_on, {
    message: "The end date cannot be before the start date",
    path: ["ended_on"],
  });
export type ApplicationEmployer = z.infer<typeof applicationEmployerSchema>;

// ── (b)(7)/(b)(8)/(b)(9) self-declared history ────────────────────────────────

/** §391.21(b)(7) — every accident in the 3 years preceding. Cross-checked against PSP crash records. */
export const applicationAccidentSchema = z.object({
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  nature: z.string().min(1).max(500),
  fatalities: z.coerce.number().int().min(0).max(999).default(0),
  injuries: z.coerce.number().int().min(0).max(999).default(0),
  hazmat_spill: z.boolean().default(false),
}).strict();
export type ApplicationAccident = z.infer<typeof applicationAccidentSchema>;

/** §391.21(b)(8) — every motor-vehicle law violation (other than parking) in the 3 years preceding. */
export const applicationViolationSchema = z.object({
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  offence: z.string().min(1).max(300),
  state: z.string().max(40).nullish(),
  penalty: z.string().max(200).nullish(),
}).strict();
export type ApplicationViolation = z.infer<typeof applicationViolationSchema>;

// ── (b)(5) every other unexpired licence or permit ────────────────────────────

/**
 * One licence or permit beyond the primary one.
 *
 * §391.21(b)(5) asks for "EACH unexpired commercial motor vehicle operator's license or permit that
 * has been issued to the applicant", and the schema carried exactly one until A3. The primary licence
 * stays flat and separate (`cdl_number`/`cdl_state`/…) because it is the one that patches
 * `drivers.cdl_number`, the one PSP matches a report against and the one a SambaSafety MVR is ordered
 * on; the union of it and this list is what satisfies the regulation.
 *
 * Usually empty, and that is expected rather than a smell: §383.21 forbids a CMV driver from holding
 * more than one driver's licence at a time. What lands here is permits, and the occasional genuine
 * second entry — which is a fact a recruiter should see rather than one the form should have made
 * unsayable.
 *
 * `issuing_authority` is free text, not a state code: the current text says "issuing driver's
 * licensing authority", which admits an authority that is not a US state.
 */
export const applicationLicenceSchema = z
  .object({
    issuing_authority: z.string().min(2).max(80),
    number: z.string().min(1).max(60),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
    /** What it is, in the applicant's words — "CDL A", "hazmat endorsement", "learner permit". */
    kind: z.string().max(80).nullish(),
  })
  .strict();
export type ApplicationLicence = z.infer<typeof applicationLicenceSchema>;

// ── the application ───────────────────────────────────────────────────────────

/**
 * The application's fields, before the cross-field rules.
 *
 * Exported separately so a wizard can `.pick()` one section's keys and validate exactly that screen
 * against the SERVER'S OWN schema (A3) — a second opinion in the client is how a form comes to accept
 * something the server rejects. The rules that span sections live in `APPLICATION_CROSS_FIELD_RULES`
 * below, applied to the whole document by `driverApplicationSchema` and to one section by whichever
 * of them names a key that section owns.
 */
export const driverApplicationObject = z
  .object({
    // (b)(2) — identity. The SSN is NOT here: §391.21(b)(2) requires it on the application, but PSP
    // matches on name/licence/state/DOB and never needs it, so it is captured on its own narrow
    // endpoint under the D-HIRE6 rules rather than riding in this body.
    first_name: z.string().min(1).max(100),
    middle_name: z.string().max(100).nullish(),
    last_name: z.string().min(1).max(100),
    date_of_birth: dateOfBirthSchema,
    email: z.email().max(200),
    phone: z.string().min(7).max(40),
    // (b)(3) — every address for the preceding 3 years.
    addresses: z.array(applicationAddressSchema).min(1),
    // (b)(5) — the licences, plural. The primary one is flat because it is the one that patches
    // `drivers` and the one the vendors match on; `additional_licences` carries the rest, which is
    // what "each unexpired ... license or permit" actually asks for.
    cdl_number: z.string().min(1).max(60),
    cdl_state: z.string().min(2).max(10),
    cdl_class: z.string().max(10).nullish(),
    cdl_expires_at: isoDateSchema,
    // Defaulted rather than required: every application filed before A3 predates the field, and an
    // applicant holding only one licence — which §383.21 makes the normal case — answers this by
    // adding nothing.
    additional_licences: z.array(applicationLicenceSchema).default([]),
    // (b)(6) — experience, in the applicant's own words.
    experience: z.string().max(4000).nullish(),
    // (b)(7)(8)(9) — self-declared history. Empty arrays are ANSWERS, not omissions; `declares_none`
    // makes the difference explicit so a blank form and a clean record are never confused.
    accidents: z.array(applicationAccidentSchema),
    declares_no_accidents: z.boolean(),
    violations: z.array(applicationViolationSchema),
    declares_no_violations: z.boolean(),
    /** (b)(9) — has a licence, permit or privilege ever been denied, revoked or suspended? */
    licence_ever_denied: z.boolean(),
    licence_denial_detail: z.string().max(1000).nullish(),
    // (b)(10) + (b)(11) — one list, sorted into two by dates and `operated_cmv`.
    employers: z.array(applicationEmployerSchema),
    declares_no_employment: z.boolean(),
    /**
     * The carrier's own questions (A9, D-APP12) — the ONE contract change this plan makes for them,
     * after which a carrier's form changes without touching anything §391.21 numbers.
     *
     * ⚠ Two fields and not one. The answers are meaningless without the exact questions that produced
     * them, so the definition's `id@version` is stored beside them — `questionnaireByRef` is what
     * turns a stored answer set back into something a reader can be shown. Nullish because every
     * application filed before A9 has neither, and because a driver who answers nothing has answered.
     *
     * ⚠ These are projected NOWHERE. Not to `drivers`, not to `driver_employment_history`, and they
     * create no DQF item — pinned by `questionnaire answers are projected nowhere`. They are rendered
     * into the application PDF, which is a derivative of this payload rather than a projection of it.
     */
    questionnaire_version: z.string().max(120).nullish(),
    questionnaire_answers: z.record(z.string(), z.unknown()).nullish(),
    // The certification. §391.21(b) closes by requiring the applicant to sign that everything is
    // true and complete, and that sentence is the whole legal weight of the document.
    certified: z.literal(true),
    signed_name: z.string().min(1).max(200),
  })
  .strict();

export type DriverApplicationFields = z.infer<typeof driverApplicationObject>;

/**
 * The rules that no single field can express, in one list rather than in a `.refine()` chain.
 *
 * A3 needs them twice — once over the whole document at submit, once over the one section a driver
 * is looking at — and two copies of "an empty list is only an answer if you SAID it was empty" is
 * two copies that drift. `check` therefore takes a PARTIAL: mid-form, most of the document does not
 * exist yet, and a rule whose fields are absent must not fire.
 *
 * Every one of them exists for the same reason (H8's lesson, restated in 0208's header): an empty
 * array is an ANSWER, not an omission, and only the driver can turn one into the other.
 */
export interface ApplicationCrossFieldRule {
  /** The field the message attaches to — and the field that decides which section owns the rule. */
  path: keyof DriverApplicationFields;
  message: string;
  check: (v: Partial<DriverApplicationFields>) => boolean;
}

export const APPLICATION_CROSS_FIELD_RULES: readonly ApplicationCrossFieldRule[] = [
  {
    path: "accidents",
    message: "List every accident in the last 3 years, or confirm there were none",
    check: (v) => v.accidents === undefined || v.accidents.length > 0 || v.declares_no_accidents === true,
  },
  {
    path: "violations",
    message: "List every violation in the last 3 years, or confirm there were none",
    check: (v) => v.violations === undefined || v.violations.length > 0 || v.declares_no_violations === true,
  },
  {
    path: "employers",
    message: "List your employers, or confirm you have not been employed",
    check: (v) => v.employers === undefined || v.employers.length > 0 || v.declares_no_employment === true,
  },
  {
    path: "licence_denial_detail",
    message: "Describe the denial, revocation or suspension",
    check: (v) => v.licence_ever_denied !== true || Boolean(v.licence_denial_detail?.trim()),
  },
];

export const driverApplicationSchema = driverApplicationObject.superRefine((v, ctx) => {
  for (const rule of APPLICATION_CROSS_FIELD_RULES) {
    if (!rule.check(v)) ctx.addIssue({ code: "custom", message: rule.message, path: [rule.path] });
  }
});
export type DriverApplication = z.infer<typeof driverApplicationSchema>;

// ── which list an entry belongs to ────────────────────────────────────────────

export type EmploymentSegment = "b10" | "b11" | "outside";

/**
 * Sort one declared employer into §391.21(b)(10), (b)(11), or neither.
 *
 * The boundary is ours to compute and the rules differ (HIRING-PLAN.md D-HIRE1):
 *   (b)(10) — overlaps the 3 years before `asOf`. ALL employment, whatever it was.
 *   (b)(11) — overlaps the 7 years before that, and ONLY if the applicant operated a CMV.
 *
 * An entry may span the boundary and belong to both, which is why this returns a set rather than one
 * label: a job from 2018 to 2025 is a (b)(10) employer AND a (b)(11) one, and dropping either half
 * would under-report a list the applicant is required to give in full.
 */
export function employmentSegments(
  employer: Pick<ApplicationEmployer, "started_on" | "ended_on" | "operated_cmv">,
  asOf: string,
): EmploymentSegment[] {
  const aStart = yearsBefore(asOf, EMPLOYMENT_WINDOW_YEARS);
  const bStart = yearsBefore(asOf, CMV_WINDOW_YEARS);
  const from = employer.started_on;
  const to = employer.ended_on ?? asOf;

  const out: EmploymentSegment[] = [];
  // Half-open [aStart, asOf] for (b)(10); [bStart, aStart) for (b)(11). A job that merely touches a
  // boundary instant belongs to the later window and to it alone.
  if (to >= aStart && from <= asOf) out.push("b10");
  if (employer.operated_cmv && to >= bStart && from < aStart) out.push("b11");
  if (out.length === 0) out.push("outside");
  return out;
}

/** Employers the applicant was REQUIRED to list, in the regulation's own terms. */
export function requiredEmployers(
  employers: readonly ApplicationEmployer[],
  asOf: string,
): { b10: ApplicationEmployer[]; b11: ApplicationEmployer[] } {
  const b10: ApplicationEmployer[] = [];
  const b11: ApplicationEmployer[] = [];
  for (const e of employers) {
    const segments = employmentSegments(e, asOf);
    if (segments.includes("b10")) b10.push(e);
    if (segments.includes("b11")) b11.push(e);
  }
  return { b10, b11 };
}
