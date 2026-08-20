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

/** True while any disclosure is still carrying draft wording — the UI should say so out loud. */
export const disclosuresAreDraft = (): boolean =>
  Object.values(DISCLOSURES).some((d) => d.version.endsWith("-draft"));

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
