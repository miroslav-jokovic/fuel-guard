import { z } from "zod";

/**
 * Driver authorizations — the disclosure catalogue and the "may we pull this" rule (0215, H1).
 *
 * ONE SOURCE OF TRUTH for what each instrument SAYS and which screening call it unlocks. The API
 * composes the stored text from `DISCLOSURES` here and never from a request body: the pattern
 * `hazmat_reviews.attestation` set in 0092 (D8) — the exact string shown is a fact worth keeping,
 * and a client-authored one is worth nothing in an audit.
 *
 * ── WHY FIVE DOCUMENTS AND NOT ONE CONSENT (HIRING-PLAN.md D-HIRE3) ─────────────────────────────
 * FCRA §604(b)(2) requires the disclosure "in a document that consists SOLELY of the disclosure".
 * Courts read `solely` literally. The authorization may be combined with the disclosure and with
 * nothing else — not with an application, not with a liability waiver, not with four other consents.
 * So each purpose is its own document with its own text and its own version, and there is nowhere to
 * put an omnibus consent even if somebody wanted one.
 */

export const AUTHORIZATION_PURPOSES = [
  "fcra_disclosure",
  "psp",
  "previous_employer",
  "clearinghouse",
  "drug_alcohol",
] as const;
export type AuthorizationPurpose = (typeof AUTHORIZATION_PURPOSES)[number];

export const AUTHORIZATION_PURPOSE_LABELS: Record<AuthorizationPurpose, string> = {
  fcra_disclosure: "Consumer report disclosure and authorization",
  psp: "FMCSA Pre-Employment Screening Program (PSP)",
  previous_employer: "Previous-employer safety performance release",
  clearinghouse: "Drug & Alcohol Clearinghouse query consent",
  drug_alcohol: "Controlled substances and alcohol testing consent",
};

export const AUTHORIZATION_METHODS = ["esign", "wet_signature", "verbal_documented"] as const;
export type AuthorizationMethod = (typeof AUTHORIZATION_METHODS)[number];

export interface DisclosureDocument {
  purpose: AuthorizationPurpose;
  /** Bumped whenever `body` or `intent` changes by a character. Stored on every row. */
  version: string;
  title: string;
  /**
   * The authority this instrument is issued under — **provenance, not screen copy.**
   *
   * ⚠ It stopped being rendered on 2026-08-22 (owner: citations are "useless and confusing for a
   * regular user"). It was a grey line under each document's title, which told an applicant about to
   * sign a background-check release nothing they could act on. What they need is the `body`, and the
   * `body` is written in English.
   *
   * The field stays because the audience it was written for still exists on the other side of the
   * screen: an auditor reading the printed file, and counsel replacing this placeholder wording, both
   * need to know which paragraph each instrument answers to. ⚠ Note that `body` and `intent` DO still
   * carry statutory references in places (§40.25(g), 49 CFR Part 40, Part 382) and are deliberately
   * untouched — those sentences are the legal instrument the driver signs, and editing them is
   * counsel's act, not a copy pass. `authorizationContract.test.ts` asserts this field still names an
   * authority.
   */
  citation: string;
  /** The disclosure itself. Shown alone — never beside another disclosure or an application field. */
  body: string;
  /** The sentence the signer affirms. ESIGN's "intent to sign" is evidenced by this, not by a mark. */
  intent: string;
}

/**
 * PLACEHOLDER TEXT, and it is marked as such on purpose (HIRING-PLAN.md Q-H3).
 *
 * The wording of a §604(b)(2) disclosure is a legal artifact, not a product one — what we own is the
 * versioning, the storage and the audit trail. `v0-draft` is deliberately not `v1`: the version
 * string is stored on every signed row, so a later swap to counsel's wording is visible in the data
 * rather than silent, and nobody can mistake a draft signature for a reviewed one.
 */
export const DISCLOSURES: Record<AuthorizationPurpose, DisclosureDocument> = {
  fcra_disclosure: {
    purpose: "fcra_disclosure",
    version: "v0-draft",
    title: "Disclosure regarding background reports",
    citation: "FCRA §604(b)(2)",
    body:
      "In connection with your application for employment, and throughout your employment if you are "
      + "hired, we may obtain one or more consumer reports about you for employment purposes. These "
      + "reports may include information about your driving record, your safety performance history "
      + "with previous employers, and your crash and roadside inspection history. This disclosure is "
      + "provided to you in a separate document that contains nothing else.",
    intent:
      "I have read this disclosure and I authorize the preparation of consumer reports about me for "
      + "employment purposes.",
  },
  psp: {
    purpose: "psp",
    version: "v0-draft",
    title: "FMCSA Pre-Employment Screening Program (PSP) disclosure and authorization",
    citation: "49 CFR §391.23; FMCSA PSP account holder agreement",
    body:
      "We are requesting your crash and roadside inspection history from the Federal Motor Carrier "
      + "Safety Administration's Pre-Employment Screening Program (PSP), which draws on the Motor "
      + "Carrier Management Information System (MCMIS). The record covers crashes from the last five "
      + "years and roadside inspections from the last three. You may review your own PSP record and "
      + "may dispute information in it with the FMCSA.",
    intent:
      "I authorize this company to obtain my PSP record from the FMCSA in connection with my "
      + "application for employment.",
  },
  previous_employer: {
    purpose: "previous_employer",
    version: "v0-draft",
    title: "Previous-employer safety performance release",
    citation: "49 CFR §391.23(a)(2), §391.53; §40.25(g)",
    body:
      "We are required to investigate your safety performance history with the DOT-regulated "
      + "employers you have worked for during the preceding three years. This release authorizes "
      + "those employers to provide us with that history, including accident information and, where "
      + "applicable, records of your participation in a controlled substances and alcohol testing "
      + "programme as §40.25(g) requires your specific written consent to release.",
    intent:
      "I authorize my previous DOT-regulated employers to release my safety performance history, "
      + "including drug and alcohol testing records, to this company.",
  },
  clearinghouse: {
    purpose: "clearinghouse",
    version: "v0-draft",
    title: "Drug & Alcohol Clearinghouse query consent",
    citation: "49 CFR §382.701(a)",
    body:
      "We are required to query the FMCSA Drug & Alcohol Clearinghouse for records of any drug or "
      + "alcohol programme violations before we may permit you to perform a safety-sensitive "
      + "function, and at least annually thereafter. A full query requires your consent, which you "
      + "give in the Clearinghouse itself; this record notes that we asked for it.",
    intent:
      "I understand a full Clearinghouse query requires my consent and that I give that consent "
      + "through the FMCSA Clearinghouse.",
  },
  drug_alcohol: {
    purpose: "drug_alcohol",
    version: "v0-draft",
    title: "Controlled substances and alcohol testing consent",
    citation: "49 CFR Part 382; Part 40",
    body:
      "As a condition of employment in a safety-sensitive function you are subject to pre-employment, "
      + "random, post-accident, reasonable-suspicion, return-to-duty and follow-up testing for "
      + "controlled substances and alcohol, conducted under 49 CFR Part 40.",
    intent: "I consent to controlled substances and alcohol testing as required by 49 CFR Part 382.",
  },
};

/**
 * Is this wording still a draft?
 *
 * Every instrument here ships as `v0-draft` placeholder text, written by an engineer, pending
 * counsel (HIRING-PLAN Q-H3). The public signing endpoint refuses those versions, and the gate is
 * deliberately tied to the HAZARD rather than to a feature flag: when real wording lands the
 * versions become `v1` and the refusal disappears by itself. A flag would have to be remembered, and
 * the thing to be remembered would be "stop collecting signatures on text no lawyer has read".
 *
 * ⚠ ONE predicate, since A4. There were two: `isDraftDisclosure` in `applicationIntake.ts`
 * (`startsWith("v0")`, the ENFORCEMENT path that refuses to record a signature) and
 * `disclosuresAreDraft` here (`endsWith("-draft")`, the one the UI reads). They agree on every string
 * in use today and diverge on the first one somebody writes carelessly — `"v1-draft"` would be
 * enforced as final and displayed as draft, which is the worst possible way round. The union of both
 * tests is the safe reading, and it lives here, beside the documents it judges.
 *
 * A4 pulled this forward from A0's checklist rather than adding a THIRD copy for the ESIGN consent.
 */
export const isDraftDisclosure = (version: string): boolean =>
  version.startsWith("v0") || version.endsWith("-draft");

/** True while any disclosure is still carrying draft wording — the UI should say so out loud. */
export const disclosuresAreDraft = (): boolean =>
  Object.values(DISCLOSURES).some((d) => isDraftDisclosure(d.version))
  || isDraftDisclosure(ESIGN_CONSENT.version);

// ── the sixth document: consent to transact electronically (A4, D-APP5) ───────

/**
 * The clauses 15 U.S.C. 7001(c)(1) requires a consumer to be given BEFORE they consent.
 *
 * Read verbatim from the statute on 2026-08-21 (Cornell LII), not recalled. 49 CFR §390.32(d) is why
 * they matter to a trucking product at all: an electronic record satisfying a Part 300–399 document
 * requirement must "include proof of consent per 15 U.S.C. 7001(c)". §391.21(b) is such a
 * requirement, so the application the driver fills in on their phone needs this consent behind it or
 * the electronic record is not the document the regulation asked for.
 *
 * ── WHY THE DOCUMENT IS A RECORD OF CLAUSES AND NOT ONE `body` STRING ─────────────────────────
 * Because 7001(c) does not ask for a disclosure "about" electronic records — it enumerates six
 * things the consumer must be told, and a prose blob can be missing one with nobody noticing until a
 * §390.32(d) challenge. Splitting it means counsel's pass (A0) fills in six named strings, the type
 * system refuses a document with a clause missing, and a reader with the statute open can check us
 * clause by clause — the same argument `applicationContract.ts` makes for following §391.21(b)'s
 * numbering.
 *
 * The stored text is still one string: `esignConsentBody()` composes it server-side, in statutory
 * order, so what the driver saw is reproducible from the version alone.
 */
export const ESIGN_CONSENT_CLAUSES = [
  "paper_option",
  "withdrawal_right",
  "scope",
  "withdrawal_procedure",
  "paper_copy",
  "system_requirements",
] as const;
export type EsignConsentClause = (typeof ESIGN_CONSENT_CLAUSES)[number];

/** What each clause must say, and the statutory cite it discharges — for the reader and the audit. */
export const ESIGN_CONSENT_CLAUSE_CITATIONS: Record<EsignConsentClause, string> = {
  paper_option: "15 U.S.C. 7001(c)(1)(B)(i)(I)",
  withdrawal_right: "15 U.S.C. 7001(c)(1)(B)(i)(II)",
  scope: "15 U.S.C. 7001(c)(1)(B)(ii)",
  withdrawal_procedure: "15 U.S.C. 7001(c)(1)(B)(iii)",
  paper_copy: "15 U.S.C. 7001(c)(1)(B)(iv)",
  system_requirements: "15 U.S.C. 7001(c)(1)(C)(i)",
};

export const ESIGN_CONSENT_CLAUSE_LABELS: Record<EsignConsentClause, string> = {
  paper_option: "You can have these on paper instead",
  withdrawal_right: "You can change your mind",
  scope: "What this consent covers",
  withdrawal_procedure: "How to withdraw, and how to update your contact details",
  paper_copy: "How to get a paper copy afterwards",
  system_requirements: "What you need to read and keep these records",
};

export interface EsignConsentDocument {
  /** Bumped whenever any clause or the intent changes by a character. Stored on every row. */
  version: string;
  title: string;
  /** As `DisclosureDocument.citation` — provenance for print and for counsel, not shown on screen. */
  citation: string;
  clauses: Record<EsignConsentClause, string>;
  /** The sentence the driver affirms. 7001(c)(1)(C)(ii)'s consent, given in the browser they read it in. */
  intent: string;
}

/**
 * PLACEHOLDER TEXT, marked as such, exactly like `DISCLOSURES` (Q-H3).
 *
 * ⚠ It is NOT in `AUTHORIZATION_PURPOSES` and must never be added: those are SCREENING
 * authorizations — each one unlocks a call to a vendor or a former employer through
 * `SCREENING_PREREQUISITES` and `hasLiveAuthorization`. This unlocks nothing and authorises nobody
 * to pull anything; it is the driver agreeing to do business on a screen instead of on paper. Adding
 * it to that list would make a PSP pull look satisfiable by the wrong consent.
 */
export const ESIGN_CONSENT: EsignConsentDocument = {
  version: "v0-draft",
  title: "Agreeing to sign and receive these documents electronically",
  citation: "15 U.S.C. 7001(c); 49 CFR §390.32(d)",
  clauses: {
    paper_option:
      "You do not have to do any of this electronically. If you would rather fill in this "
      + "application on paper and sign it by hand, tell the carrier and they will send you one.",
    withdrawal_right:
      "You can withdraw this consent at any time. If you withdraw it before you have sent your "
      + "application, this link stops working and the carrier will send you a paper form instead; "
      + "nothing you have already signed is undone, and there is no fee either way.",
    scope:
      "This consent covers this job application and the authorizations that go with it — nothing "
      + "else, and nothing after you are hired.",
    withdrawal_procedure:
      "To withdraw your consent, or to give the carrier a new email address or phone number, "
      + "contact the carrier directly using the details in the message that sent you this link.",
    paper_copy:
      "After you have sent your application you can ask the carrier for a paper copy of anything "
      + "you signed, at no charge.",
    system_requirements:
      "You need a device with a current web browser and an internet connection to read and sign "
      + "these documents, and either a printer or somewhere to save a PDF if you want to keep your "
      + "own copy.",
  },
  intent:
    "I agree to sign this application and its authorizations electronically, and to receive the "
    + "records that go with them electronically.",
};

/**
 * Must this link carry a 7001(c) consent before anything else may be written to it?
 *
 * ⚠ The gate is armed by A0, not by A4. Requiring it unconditionally today would take the
 * application offline: the document is `v0-draft`, no consent may be recorded against text no lawyer
 * has read, and the gate would refuse every write with no way through it. So the requirement is tied
 * to the same hazard the signing gate is tied to — while the wording is draft the link behaves as it
 * did before A4, and the moment counsel's text is published the gate closes by itself on every write
 * path. A flag would have to be remembered, and what would need remembering is "start requiring the
 * consent the regulation requires".
 */
export const esignConsentRequired = (
  consentedAt: string | null,
  doc: EsignConsentDocument = ESIGN_CONSENT,
): boolean => !isDraftDisclosure(doc.version) && !consentedAt;

/**
 * The exact text the driver is shown and the row stores — composed here, never sent by a client.
 *
 * In statutory order, each clause labelled, so the stored string is reproducible from the version and
 * a reader can find the paragraph a challenge is about. Same rule as the disclosures: the API
 * composes what was agreed to, because a client-authored record of consent is worth nothing.
 */
export function esignConsentBody(doc: EsignConsentDocument = ESIGN_CONSENT): string {
  return ESIGN_CONSENT_CLAUSES.map(
    (clause) => `${ESIGN_CONSENT_CLAUSE_LABELS[clause]}\n${doc.clauses[clause]}`,
  ).join("\n\n");
}

// ── the wire shape ────────────────────────────────────────────────────────────

export const driverAuthorizationSchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  purpose: z.string(),
  disclosure_version: z.string(),
  disclosure_text: z.string(),
  method: z.string(),
  signed_name: z.string(),
  intent_statement: z.string(),
  esign_consent_at: z.string().nullable(),
  accepted_at: z.string(),
  evidence_document_id: z.uuid().nullable(),
  revokes: z.uuid().nullable(),
  revoke_reason: z.string().nullable(),
  created_at: z.string(),
});
export type DriverAuthorization = z.infer<typeof driverAuthorizationSchema>;

/**
 * What a caller may send. `disclosure_text`, `disclosure_version` and `intent_statement` are ABSENT
 * on purpose — the server takes all three from `DISCLOSURES`, so a client cannot record that somebody
 * agreed to wording nobody approved.
 */
export const authorizationGrantSchema = z
  .object({
    driver_id: z.uuid(),
    purpose: z.enum(AUTHORIZATION_PURPOSES),
    method: z.enum(AUTHORIZATION_METHODS),
    signed_name: z.string().min(1).max(200),
    /** Present when the signer agreed to transact electronically; required for `method: 'esign'`. */
    esign_consent: z.boolean().optional(),
    evidence_document_id: z.uuid().nullish(),
  })
  .strict()
  .refine((v) => v.method !== "esign" || v.esign_consent === true, {
    message: "An electronic signature requires the signer's consent to transact electronically",
    path: ["esign_consent"],
  });
export type AuthorizationGrant = z.infer<typeof authorizationGrantSchema>;

export const authorizationRevokeSchema = z
  .object({ revokes: z.uuid(), reason: z.string().min(1).max(500) })
  .strict();
export type AuthorizationRevoke = z.infer<typeof authorizationRevokeSchema>;

export const driverAuthorizationsResponseSchema = z.object({
  authorizations: z.array(driverAuthorizationSchema),
});

// ── the rule ──────────────────────────────────────────────────────────────────

/** The subset of a row this judgement needs. */
export interface AuthorizationRow {
  id: string;
  purpose: string;
  accepted_at: string;
  revokes: string | null;
}

/**
 * Is there a LIVE authorization for this purpose?
 *
 * Append-only means the answer is a fold, not a column read: take the grants for this purpose, drop
 * any that a later row revokes, and ask whether one survives. Doing it this way is what keeps "what
 * did we hold at the moment we made the request" answerable — a mutable `revoked_at` would have
 * overwritten exactly that.
 */
export function liveAuthorization(
  rows: readonly AuthorizationRow[],
  purpose: AuthorizationPurpose,
): AuthorizationRow | null {
  const revoked = new Set(rows.map((r) => r.revokes).filter((id): id is string => id !== null));
  const grants = rows
    .filter((r) => r.revokes === null && r.purpose === purpose && !revoked.has(r.id))
    .sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));
  return grants[0] ?? null;
}

export const hasLiveAuthorization = (
  rows: readonly AuthorizationRow[],
  purpose: AuthorizationPurpose,
): boolean => liveAuthorization(rows, purpose) !== null;

/**
 * Which purposes a screening call needs before it may be made.
 *
 * PSP needs its own authorization AND the FCRA disclosure: the PSP account-holder agreement demands
 * the first, and the second is required if a PSP report is a consumer report — which is Q7, still
 * open. Requiring both is the answer that is correct either way, and the cost of being wrong in this
 * direction is one extra signature.
 */
export const SCREENING_PREREQUISITES: Record<string, readonly AuthorizationPurpose[]> = {
  psp_record: ["psp", "fcra_disclosure"],
  mvr_order: ["fcra_disclosure"],
  previous_employer_inquiry: ["previous_employer"],
  clearinghouse_full: ["clearinghouse"],
};

/** Which prerequisites are missing — named, so a refusal can say what to go and get. */
export function missingAuthorizations(
  rows: readonly AuthorizationRow[],
  call: keyof typeof SCREENING_PREREQUISITES | string,
): AuthorizationPurpose[] {
  const required = SCREENING_PREREQUISITES[call] ?? [];
  return required.filter((p) => !hasLiveAuthorization(rows, p));
}
