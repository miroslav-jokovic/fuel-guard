import { z } from "zod";

/**
 * The §391.23 previous-employer inquiry — what we ask, and how the asking is recorded
 * (EMPLOYER-INQUIRY-PLAN E2/E3). Regulatory text verified against Cornell LII on 2026-08-20.
 *
 * ── WHAT THE LETTER ASKS FOR, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────
 * §391.23(d): general driver identification and employment verification, plus the §390.15(b)(1)
 * accident data for the three years before the application.
 *
 * It does NOT ask an FMCSA-regulated carrier for drug and alcohol history. **Since 2023-01-06,
 * §391.23(e) directs employers subject to §382.701(a) to use the Drug & Alcohol Clearinghouse for
 * that, with respect to FMCSA-regulated employers.** A letter asking a former carrier for it would
 * be asking for something the regulation now routes elsewhere, and the answer belongs to the
 * Clearinghouse query the catalogue already tracks as `clearinghouse_preemployment`.
 *
 * §40.25 survives for NON-FMCSA DOT safety-sensitive employment — an applicant coming from an FAA,
 * FRA, FTA, PHMSA or USCG job — and that is a different letter with a different window (two years,
 * not three) and a hard precondition: §40.25(a)(1) requires the employee's written consent, and
 * refusal means they may not perform safety-sensitive functions.
 *
 * ── WHY THE WORDING IS VERSIONED AND SERVER-COMPOSED ───────────────────────────────────────────
 * §391.23(i) gives the driver the right to review what was received, and (c)(2) requires a record of
 * what was asked. Both are answerable only if the exact words sent in March are still readable in
 * September. Same rule as `DISCLOSURES`, same reason: a client-authored letter is worth nothing in
 * an audit.
 */

export const INQUIRY_KINDS = ["safety_performance", "drug_alcohol"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

export const INQUIRY_KIND_LABELS: Record<InquiryKind, string> = {
  safety_performance: "Safety performance history (§391.23)",
  drug_alcohol: "Drug and alcohol history (§40.25)",
};

/** How a previous employer was contacted. §391.23(c)(2) records "the attempts made", not the medium. */
export const INQUIRY_METHODS = ["email", "post", "fax", "phone", "portal"] as const;
export type InquiryMethod = (typeof INQUIRY_METHODS)[number];

export const INQUIRY_METHOD_LABELS: Record<InquiryMethod, string> = {
  email: "Email",
  post: "Post",
  fax: "Fax",
  phone: "Telephone",
  portal: "The employer's own portal",
};

export interface InquiryDocument {
  kind: InquiryKind;
  /** Bumped whenever `body` changes by a character. Stored on every attempt that sends it. */
  version: string;
  title: string;
  citation: string;
  /** `{{driver}}`, `{{carrier}}` and `{{window}}` are filled in when an attempt is composed. */
  body: string;
}

/**
 * The §391.23(d) letter is NOT placeholder text — it asks for what the regulation names, in the
 * regulation's own terms, and needs no legal review to be correct about that. The §40.25 letter is
 * `v0-draft` for the same reason the disclosures are (HIRING-PLAN Q-H3): it rests on a consent whose
 * wording has not been settled, so nothing may send it until that is resolved.
 */
export const EMPLOYER_INQUIRIES: Record<InquiryKind, InquiryDocument> = {
  safety_performance: {
    kind: "safety_performance",
    version: "v1",
    title: "Request for safety performance history",
    citation: "49 CFR §391.23(d); data elements per §390.15(b)(1)",
    body:
      "{{carrier}} is considering {{driver}} for employment as a commercial motor vehicle driver and "
      + "is required by 49 CFR §391.23(a)(2) to investigate their safety performance history with "
      + "Department of Transportation regulated employers for the three years preceding their "
      + "application.\n\n"
      + "Our records show that {{driver}} was employed by you during {{window}}. Under §391.23(d) we "
      + "request:\n\n"
      + "1. Confirmation of the driver's identification and the dates of their employment with you.\n"
      + "2. The accident information specified in §390.15(b)(1) for any accident involving this "
      + "driver during the three years preceding their application — the date, the city or town and "
      + "state, the number of fatalities and injuries, and whether hazardous materials other than "
      + "fuel spilled.\n"
      + "3. Any other accidents involving this driver that you retain under §390.15(b)(2) or your own "
      + "policies, if you choose to provide them.\n\n"
      + "If there were no such accidents, please say so — a nil return is a complete answer and we "
      + "will record it as one.\n\n"
      + "49 CFR §391.23(g)(1) requires a response within 30 days of your receipt of this request. If "
      + "we receive no reply we are required to document our efforts to obtain one, and we will "
      + "record this request and any further attempts accordingly.\n\n"
      + "We will use this information only to decide whether to employ this driver, and will protect "
      + "it from disclosure to anyone not directly involved in that decision, as §391.23(k) requires. "
      + "The driver has the right to review the information you provide.",
  },
  drug_alcohol: {
    kind: "drug_alcohol",
    version: "v0-draft",
    title: "Request for drug and alcohol testing history",
    citation: "49 CFR §40.25(b); consent per §40.25(a)(1)",
    body:
      "PLACEHOLDER — not to be sent. {{carrier}} is considering {{driver}} for a safety-sensitive "
      + "position and requests the information listed in 49 CFR §40.25(b) for the two years before "
      + "their application: alcohol tests with a result of 0.04 or higher, verified positive drug "
      + "tests, refusals to test, other violations of DOT drug and alcohol regulations, and "
      + "documentation of any completed return-to-duty requirements.\n\n"
      + "This request must be accompanied by the driver's specific written consent under §40.25(a)(1). "
      + "The wording of that consent is not final, so this letter cannot be sent.",
  },
};

/** True while an inquiry's wording is still draft — nothing may send one, and the UI says why. */
export const isDraftInquiry = (doc: InquiryDocument): boolean => doc.version.endsWith("-draft");

/**
 * Compose the letter for one employer. The placeholders are filled HERE rather than by a client, so
 * the stored `body_sent` is the text that actually went out.
 */
export function composeInquiry(
  doc: InquiryDocument,
  fields: { driver: string; carrier: string; window: string },
): string {
  return doc.body
    .replaceAll("{{driver}}", fields.driver)
    .replaceAll("{{carrier}}", fields.carrier)
    .replaceAll("{{window}}", fields.window);
}

/** The employment period, in the words the letter uses. An open-ended job reads as "to the present". */
export const inquiryWindow = (startedOn: string, endedOn: string | null): string =>
  `${startedOn} to ${endedOn ?? "the present"}`;

// ── the API contract ─────────────────────────────────────────────────────────────────────────────

/**
 * Recording an attempt. `method` decides what else is required, and the API composes the body — the
 * request says who was contacted and how, never what they were told.
 */
export const inquiryAttemptSchema = z.object({
  employment_id: z.uuid(),
  kind: z.enum(INQUIRY_KINDS).default("safety_performance"),
  method: z.enum(INQUIRY_METHODS),
  /** When the contact was made. Backdating is normal here — the office posted it on Tuesday. */
  contacted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  /** Where it went: an address, an email, a fax number, or who was spoken to. */
  sent_to: z.string().min(1).max(300),
  note: z.string().max(1000).nullish(),
});
export type InquiryAttempt = z.infer<typeof inquiryAttemptSchema>;

export const INQUIRY_OUTCOMES = ["awaiting", "responded", "no_response", "undeliverable"] as const;
export type InquiryOutcome = (typeof INQUIRY_OUTCOMES)[number];

export const INQUIRY_OUTCOME_LABELS: Record<InquiryOutcome, string> = {
  awaiting: "Awaiting a reply",
  responded: "Answered",
  no_response: "Documented non-response",
  undeliverable: "Did not reach them",
};

/**
 * Closing an attempt. Deliberately small — the STRUCTURED reply (dates of employment, §390.15(b)(1)
 * accident data) and the scan behind it are E4; this is the half that makes the derived status
 * meaningful, and it is what turns a documented non-response into the answer §391.23(c)(1) accepts.
 */
export const inquiryOutcomeSchema = z.object({
  outcome: z.enum(INQUIRY_OUTCOMES).refine((v) => v !== "awaiting", {
    message: "Choose what happened",
  }),
  outcome_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  note: z.string().max(1000).nullish(),
});
export type InquiryOutcomeUpdate = z.infer<typeof inquiryOutcomeSchema>;
