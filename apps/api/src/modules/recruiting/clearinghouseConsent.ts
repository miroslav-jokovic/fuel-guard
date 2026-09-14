/**
 * The Clearinghouse limited-query consent — FMCSA's sample, with the one decision it leaves us.
 *
 * ── ⚠ THE PLACEHOLDER DESCRIBED THE WRONG INSTRUMENT ──────────────────────────────────────────
 * `DISCLOSURES.clearinghouse` says the consent "is given in the Clearinghouse itself; this record
 * notes that we asked for it". That is true of a **full** query (§382.701(a)) — the pre-employment
 * one, where the driver consents inside the FMCSA portal and no paper passes between us. It is not
 * true of the instrument a carrier actually holds.
 *
 * §382.701(b) requires a **limited** query at least once a year for every driver, and a limited
 * query runs on a consent the EMPLOYER obtains directly, in writing or electronically. That consent
 * is a document, we have never had one, and the catalogue entry named after it described the other
 * query type. Researched and corrected 2026-09-13.
 *
 * ── WHAT FMCSA PUBLISHES, AND HOW FAR IT BINDS ────────────────────────────────────────────────
 * A **sample**, not a mandate — and the difference from PSP is the whole reason this module looks
 * different from `pspDisclosure.ts`. The form says so in its own first line:
 *
 *   "FMCSA does not require that motor carrier employers … use this sample format to obtain an
 *    employee's consent to conduct a limited query … Employers may, however, use or adapt the
 *    content as they see fit."
 *
 * So there is no `missingParagraphs` refusal here and there must not be one. PSP's language is
 * mandatory and publishing anything else breaks the account-holder agreement; this one a carrier is
 * free to adapt, and a gate would be us inventing an obligation the agency declined to impose.
 *
 * Downloaded 2026-09-13 from
 * https://clearinghouse.fmcsa.dot.gov/Resource/Index/Sample-Limited-Consent-Form ; the PDF and its
 * `pdftotext -layout` extraction are committed under
 * `docs/plans/recruitment/clearinghouse-consent/`, where "reproduces all three, word for word"
 * compares them.
 *
 * ── ⚠ THE DECISION FMCSA HANDS BACK, AND HOW IT WAS TAKEN ─────────────────────────────────────
 * The sample carries a bracketed instruction where the scope belongs:
 *
 *   "[Employers and employees may also wish to include the terms of the consent. For example, is
 *    the driver consenting to a single limited query or multiple limited queries? … Is the number
 *    of limited queries specific or unlimited?]"
 *
 * That bracket is **guidance to the employer and must never be shown to a driver**, so it is not
 * transcribed; what replaces it is an answer. The answer is forced rather than chosen: §382.701(b)
 * requires a limited query **at least annually for as long as the driver is employed**, so a
 * consent good for one query, or for a fixed window, would expire into a compliance failure and
 * have to be re-collected from every driver every year. Multiple queries, for the duration of the
 * engagement, unlimited in number, is the only scope that matches the obligation it exists to
 * satisfy. It is written in the form's own voice and marked below as OURS rather than FMCSA's.
 */

const COMPANY = "{{COMPANY}}";

export const CLEARINGHOUSE_FORM_SOURCE_URL =
  "https://clearinghouse.fmcsa.dot.gov/Resource/Index/Sample-Limited-Consent-Form";

export const CLEARINGHOUSE_CONSENT_TITLE =
  "General Consent for Limited Queries of the Federal Motor Carrier Safety Administration (FMCSA) Drug and Alcohol Clearinghouse";

/**
 * FMCSA's three paragraphs, verbatim, with `(Driver Name)` dropped.
 *
 * ⚠ The driver's name is dropped rather than substituted because this product does not ask a signer
 * to type their name into the body of an instrument — `driver_authorizations.signed_name` is where
 * who-signed lives, captured by the ceremony and stored beside the text. Leaving `(Driver Name)` in
 * the sentence would render a literal parenthesis to the driver; substituting it would put the same
 * fact in two places, one of them inside a legal instrument where a typo cannot be corrected.
 */
export const CLEARINGHOUSE_FMCSA_PARAGRAPHS: readonly string[] = [
  `I hereby provide consent to ${COMPANY} to conduct a limited query of the FMCSA Commercial Driver’s License Drug and Alcohol Clearinghouse (Clearinghouse) to determine whether drug or alcohol violation information about me exists in the Clearinghouse.`,

  `I understand that if the limited query conducted by ${COMPANY} indicates that drug or alcohol violation information about me exists in the Clearinghouse, FMCSA will not disclose that information to ${COMPANY} without first obtaining additional specific consent from me.`,

  `I further understand that if I refuse to provide consent for ${COMPANY} to conduct a limited query of the Clearinghouse, ${COMPANY} must prohibit me from performing safety-sensitive functions, including driving a commercial motor vehicle, as required by FMCSA’s drug and alcohol program regulations.`,
];

/**
 * ⚠ **OURS, not FMCSA's** — the scope the sample's bracket instructs the employer to supply.
 *
 * Kept as its own exported constant rather than folded into the paragraphs above, so that the line
 * between what the agency wrote and what we decided stays visible to the next reader and to the
 * test that asserts FMCSA's own text is reproduced exactly. See the header for why the answer is
 * forced by §382.701(b) rather than chosen.
 */
export const CLEARINGHOUSE_SCOPE_PARAGRAPH =
  "This consent covers more than one limited query. It applies for as long as I am employed by or"
  + " under contract to {{COMPANY}}, and there is no limit on the number of limited queries that may"
  + " be conducted during that time. I understand that federal law requires a limited query to be run"
  + " at least once a year, and that I may withdraw this consent at any time by telling {{COMPANY}} in"
  + " writing — in which case I understand they must stop me performing safety-sensitive functions.";

/**
 * The sentence the signer affirms.
 *
 * ⚠ Also ours: the sample has a bare signature line and no affirmation, because a paper form's
 * signature block IS the affirmation. An electronic signature needs the intent said out loud
 * (15 U.S.C. 7001(c)(1)(C)(ii)), which is what `intent_statement` stores.
 */
export const CLEARINGHOUSE_INTENT =
  "I consent to {{COMPANY}} running limited queries of the FMCSA Drug and Alcohol Clearinghouse"
  + " about me, on the terms set out above.";

export interface ClearinghouseConsent {
  title: string;
  body: string;
  intent: string;
}

/** The instrument, with the carrier's name in every place the sample leaves `(Company Name)`. */
export function clearinghouseConsent(carrierName: string): ClearinghouseConsent {
  const company = carrierName.trim() || "the carrier";
  const fill = (s: string): string => s.split(COMPANY).join(company);
  return {
    title: CLEARINGHOUSE_CONSENT_TITLE,
    // FMCSA's first paragraph, then our scope, then FMCSA's remaining two — the scope sits where
    // the bracket sat, which is where a reader of the sample would expect to find it.
    body: [
      fill(CLEARINGHOUSE_FMCSA_PARAGRAPHS[0]!),
      fill(CLEARINGHOUSE_SCOPE_PARAGRAPH),
      ...CLEARINGHOUSE_FMCSA_PARAGRAPHS.slice(1).map(fill),
    ].join("\n\n"),
    intent: fill(CLEARINGHOUSE_INTENT),
  };
}
