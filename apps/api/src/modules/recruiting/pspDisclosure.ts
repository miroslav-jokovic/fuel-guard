/**
 * The PSP disclosure and authorization — FMCSA's own words, and not ours to write (2026-09-13).
 *
 * ── WHY THIS IS A FILE AND NOT A SETTING ──────────────────────────────────────────────────────
 * `WORDING-REVIEW-2026-09-13.md` §3 recorded that the carrier's packet has no PSP authorization
 * anywhere in it, and asked the owner to choose between publishing our placeholder, asking counsel
 * for a page, and dropping PSP from the applicant's path. **All three were wrong, because the
 * question had already been answered by the regulator.** FMCSA publishes the language and requires
 * it, in terms that leave a carrier no drafting discretion at all:
 *
 *   "account holders are required by FMCSA to use the language contained in this Disclosure and
 *    Authorization form to obtain an Applicant's consent. The language must be used in whole,
 *    exactly as provided. Further, the language on this form must exist as one stand-alone
 *    document. The language may NOT be included with other consent forms or any other language."
 *
 * So there is nothing for counsel to draft and nothing for a carrier to adopt. There is a form, it
 * is mandatory, and the only correct implementation is to reproduce it.
 *
 * ── PROVENANCE, KEPT SO THE CLAIM IS CHECKABLE ────────────────────────────────────────────────
 * Downloaded 2026-09-13 from
 * https://www.psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf
 * (the form is dated `LAST UPDATED 2/11/2016`). Both the PDF and its `pdftotext -layout` extraction
 * are committed under `docs/plans/recruitment/psp-disclosure/`, and `pspDisclosure.test.ts` compares
 * every paragraph below against the extraction — so a transcription that drifts from the federal
 * form fails the build, exactly as `packetWording.test.ts` does for the carrier's own packet.
 *
 * ⚠ **No repair register, and the absence is the point.** The packet's wording gets its typos fixed
 * under a recorded, word-count-guarded rule (D-PKT9 — itself reversed by D-PKT11, so nothing is
 * repaired anywhere now). This text gets nothing either: "exactly as provided"
 * is an instruction from the agency whose system we are about to query, and a spelling improvement
 * to it would be a breach of the account-holder agreement rather than a courtesy. The only thing
 * done to these strings is collapsing the PDF's hard line-wraps, which are the renderer's geometry
 * and not the agency's words.
 */

/**
 * The blank the form leaves for the carrier's name, twice.
 *
 * ⚠ Filling it is not an edit to the language — it is the form's own fill-in field, and the defined
 * term `("Prospective Employer")` immediately after it is what the rest of the text refers back to.
 * Leaving it blank would produce an instrument that authorises nobody.
 */
const EMPLOYER = "{{EMPLOYER}}";

export const PSP_FORM_SOURCE_URL =
  "https://www.psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf";

/** The form's own footer date. Bump it — and re-download — only when FMCSA republishes. */
export const PSP_FORM_LAST_UPDATED = "2/11/2016";

export const PSP_DISCLOSURE_TITLE =
  "IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service";

/**
 * Everything above the signature line, in the form's own order.
 *
 * ⚠ The two closing NOTICE paragraphs are included. They read as addressed to the account holder
 * rather than to the driver, and on paper they sit BELOW the signature — but "in whole, exactly as
 * provided" is not a sentence to be clever about, and over-inclusion cannot breach it where an
 * omission could. Flagged for counsel in `WORDING-REVIEW-2026-09-13.md` §4.3 rather than decided
 * here.
 */
const DISCLOSURE_PARAGRAPHS: readonly string[] = [
  `In connection with your application for employment with ${EMPLOYER} (“Prospective Employer”), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving, and safety inspection history from the Federal Motor Carrier Safety Administration (FMCSA).`,

  "When the application for employment is submitted in person, if the Prospective Employer uses any information it obtains from FMCSA in a decision to not hire you or to make any other adverse employment decision regarding you, the Prospective Employer will provide you with a copy of the report upon which its decision was based and a written summary of your rights under the Fair Credit Reporting Act before taking any final adverse action. If any final adverse action is taken against you based upon your driving history or safety report, the Prospective Employer will notify you that the action has been taken and that the action was based in part or in whole on this report.",

  "When the application for employment is submitted by mail, telephone, computer, or other similar means, if the Prospective Employer uses any information it obtains from FMCSA in a decision to not hire you or to make any other adverse employment decision regarding you, the Prospective Employer must provide you within three business days of taking adverse action oral, written or electronic notification: that adverse action has been taken based in whole or in part on information obtained from FMCSA; the name, address, and the toll free telephone number of FMCSA; that the FMCSA did not make the decision to take the adverse action and is unable to provide you the specific reasons why the adverse action was taken; and that you may, upon providing proper identification, request a free copy of the report and may dispute with the FMCSA the accuracy or completeness of any information or report. If you request a copy of a driver record from the Prospective Employer who procured the report, then, within 3 business days of receiving your request, together with proper identification, the Prospective Employer must send or provide to you a copy of your report and a summary of your rights under the Fair Credit Reporting Act.",

  "Neither the Prospective Employer nor the FMCSA contractor supplying the crash and safety information has the capability to correct any safety data that appears to be incorrect. You may challenge the accuracy of the data by submitting a request to https://dataqs.fmcsa.dot.gov. If you challenge crash or inspection information reported by a State, FMCSA cannot change or correct this data. Your request will be forwarded by the DataQs system to the appropriate State for adjudication.",

  "Any crash or inspection in which you were involved will display on your PSP report. Since the PSP report does not report, or assign, or imply fault, it will include all Commercial Motor Vehicle (CMV) crashes where you were a driver or co-driver and where those crashes were reported to FMCSA, regardless of fault. Similarly, all inspections, with or without violations, appear on the PSP report. State citations associated with Federal Motor Carrier Safety Regulations (FMCSR) violations that have been adjudicated by a court of law will also appear, and remain, on a PSP report.",

  "The Prospective Employer cannot obtain background reports from FMCSA without your authorization.",

  "AUTHORIZATION",

  "If you agree that the Prospective Employer may obtain such background reports, please read the following and sign below:",

  `I authorize ${EMPLOYER} (“Prospective Employer”) to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record and information regarding my safety inspection history. I understand that I am authorizing the release of safety performance information including crash data from the previous five (5) years and inspection history from the previous three (3) years. I understand and acknowledge that this release of information may assist the Prospective Employer to make a determination regarding my suitability as an employee.`,

  "I further understand that neither the Prospective Employer nor the FMCSA contractor supplying the crash and safety information has the capability to correct any safety data that appears to be incorrect. I understand I may challenge the accuracy of the data by submitting a request to https://dataqs.fmcsa.dot.gov. If I challenge crash or inspection information reported by a State, FMCSA cannot change or correct this data. I understand my request will be forwarded by the DataQs system to the appropriate State for adjudication.",

  "I understand that any crash or inspection in which I was involved will display on my PSP report. Since the PSP report does not report, or assign, or imply fault, I acknowledge it will include all CMV crashes where I was a driver or co-driver and where those crashes were reported to FMCSA, regardless of fault. Similarly, I understand all inspections, with or without violations, will appear on my PSP report, and State citations associated with FMCSR violations that have been adjudicated by a court of law will also appear, and remain, on my PSP report.",

  "NOTICE: This form is made available to monthly account holders by NIC on behalf of the U.S. Department of Transportation, Federal Motor Carrier Safety Administration (FMCSA). Account holders are required by federal law to obtain an Applicant’s written or electronic consent prior to accessing the Applicant’s PSP report. Further, account holders are required by FMCSA to use the language contained in this Disclosure and Authorization form to obtain an Applicant’s consent. The language must be used in whole, exactly as provided. Further, the language on this form must exist as one stand-alone document. The language may NOT be included with other consent forms or any other language.",

  "NOTICE: The prospective employment concept referenced in this form contemplates the definition of “employee” contained at 49 C.F.R. 383.5.",
];

/**
 * The sentence the driver affirms — the form's own final paragraph, which on paper sits immediately
 * above the signature line. It is carried as the `intent` for that reason and not as a summary of
 * our own: `driver_authorizations.intent_statement` is what an audit reads as evidence of assent,
 * and a paraphrase there would be evidence of nothing.
 */
const AUTHORIZATION_INTENT =
  "I have read the above Disclosure Regarding Background Reports provided to me by Prospective Employer and I understand that if I sign this Disclosure and Authorization, Prospective Employer may obtain a report of my crash and inspection history. I hereby authorize Prospective Employer and its employees, authorized agents, and/or affiliates to obtain the information authorized above.";

export interface PspDisclosure {
  title: string;
  body: string;
  intent: string;
}

/**
 * The mandated instrument, with the carrier's name in the two blanks the form leaves for it.
 *
 * A carrier with no name on file would produce an instrument authorising nobody, so the blank is
 * kept visible as underscores rather than collapsing to an empty string — an office proof-reading
 * the draft sees a gap to fill instead of a sentence that reads correctly and means nothing.
 */
export function pspDisclosure(carrierName: string): PspDisclosure {
  const employer = carrierName.trim() || "_________________________";
  return {
    title: PSP_DISCLOSURE_TITLE,
    body: DISCLOSURE_PARAGRAPHS.map((p) => p.split(EMPLOYER).join(employer)).join("\n\n"),
    intent: AUTHORIZATION_INTENT,
  };
}

/** Whitespace-insensitive, because a publish round-trips through a textarea. */
const flatten = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Does this body still carry every mandated paragraph?
 *
 * ⚠ **This is a REFUSAL, not a warning, and it is the only place in the wording feature where a
 * carrier is told what it may publish.** Everywhere else the carrier's own text wins, because the
 * instruments are theirs. This one is not theirs: FMCSA requires the language "in whole, exactly as
 * provided", and a PSP request made behind an edited consent breaches the account-holder agreement
 * the API token depends on. Letting an office quietly shorten it would be letting them lose their
 * PSP access without being told.
 *
 * Compared paragraph by paragraph rather than as one string, so the refusal can NAME what went
 * missing; and with the employer blank ignored, because filling that in is the form's own
 * instruction rather than an edit to it.
 */
export function missingPspParagraphs(body: string): string[] {
  const hay = flatten(body);
  return DISCLOSURE_PARAGRAPHS.flatMap((p) => {
    const [before, after] = p.split(EMPLOYER);
    const parts = after === undefined ? [p] : [before!, after];
    // A paragraph carrying the blank is checked as the two fragments either side of it, so any
    // carrier name at all satisfies it and a deleted clause still does not.
    return parts.every((part) => hay.includes(flatten(part))) ? [] : [p.slice(0, 60)];
  });
}

/** The whole paragraph list, for the tests and the review document. */
export const PSP_MANDATED_PARAGRAPHS = DISCLOSURE_PARAGRAPHS;
export const PSP_MANDATED_INTENT = AUTHORIZATION_INTENT;
