import {
  AUTHORIZATION_PURPOSE_LABELS,
  type AuthorizationPurpose,
} from "@silvicom/shared";
import { field, heading, muted, rule, section } from "../../../lib/pdfDraw.js";
import type { ApplicationPdfInput } from "./render.js";

/**
 * A value, or an em dash — the same rule the rest of this document follows.
 *
 * ⚠ Declared here rather than imported from `render.ts`, which is where its twin lives: this module
 * is imported BY that one, and reaching back for a helper would make the pair circular at runtime for
 * a four-token function. The type import above is erased and does not.
 */
const blank = (v: string | null | undefined): string => (v && v.trim() !== "" ? v : "—");

/** The instrument's name, not its token. Falls back to what was stored for a purpose we retired. */
export const purposeLabel = (purpose: string): string =>
  AUTHORIZATION_PURPOSE_LABELS[purpose as AuthorizationPurpose] ?? purpose;

/** A timestamp to the second, in UTC and labelled as such — "2026-09-11 14:07:33 UTC". */
const stamp = (iso: string | null | undefined): string =>
  iso ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC` : "—";

/**
 * ── THE CERTIFICATE OF COMPLETION (X7, D-AX8) ─────────────────────────────────────────────────
 *
 * Every signature in this flow is already stored with eight facts: the exact text, its version, the
 * intent sentence, the signed name, the method, the moment, the address it came from and the browser
 * it was made in (`driver_authorizations`, 0215/0228). The rendered document printed five of them,
 * spread over one page per instrument, and gathered them nowhere.
 *
 * So a reader holding the filed PDF could see WHAT was signed and not HOW — and "how" is the whole
 * of the question a challenged signature raises. This page answers it in one place, which is what
 * every commercial e-signature product hands over and what this product had the ingredients for and
 * never assembled.
 *
 * ⚠ It is a PAGE of the application, not a second file (D-AX8). §390.32(d) asks for one reproducible
 * record; a separate certificate is a second document to lose, and the §391.51 file has one slot.
 */
export function certificate(
  doc: PDFKit.PDFDocument,
  input: ApplicationPdfInput,
  opts: { source?: string } = {},
): void {
  doc.addPage();
  heading(doc, "Certificate of completion");
  muted(
    doc,
    "How this application was signed, and what the carrier's system recorded at the moment of each "
    + "act. Every time is the server's, taken when the act was received, and none of it is supplied "
    + "by the signer.",
  );
  doc.moveDown(0.5);

  field(doc, input.preview ? "Invitation" : "Application", input.applicationId);
  // ⚠ "Signer" is the person who made the §391.21(b)(12) certification, and on a preview nobody has.
  // Naming the applicant under that label would be the one line on this page that asserts an act.
  if (input.preview) {
    const a = input.application;
    field(doc, "Applicant", blank([a.first_name, a.last_name].filter(Boolean).join(" ")));
  } else {
    field(doc, "Signer", blank(input.signedName));
  }
  rule(doc);

  /**
   * ⚠ **Every act below is drawn through `section()`, which keeps its heading with its rows
   * (AUD-4).** Measured 2026-09-19 on this very page: the last instrument's heading and two of its
   * four rows were on one sheet and `From address` and `Browser` opened the next, directly under a
   * heading numbered for a DIFFERENT instrument. On a document whose whole purpose is to say which
   * act happened when, two rows filed under the wrong act is the worst thing it can do quietly.
   */
  if (input.esignConsent) {
    section(doc, "1. Agreed to sign electronically", [
      { note: `15 U.S.C. 7001(c) · version ${input.esignConsent.disclosure_version}` },
      { label: "Agreed", value: stamp(input.esignConsent.consented_at) },
      { label: "From address", value: blank(input.esignConsent.applicant_ip) },
      { label: "Browser", value: blank(input.esignConsent.applicant_user_agent) },
    ]);
    doc.moveDown(0.4);
  }

  input.authorizations.forEach((auth, i) => {
    // Numbered from the consent, so the list reads as the order the acts happened in rather than as
    // an unordered set — which is the question "what did they agree to, and when" actually asks.
    section(doc, `${(input.esignConsent ? 2 : 1) + i}. ${purposeLabel(auth.purpose)}`, [
      { note: `Version ${auth.disclosure_version} · method ${auth.method}` },
      { label: "Signed as", value: blank(auth.signed_name) },
      { label: "Signed", value: stamp(auth.accepted_at) },
      { label: "From address", value: blank(auth.accepted_ip) },
      { label: "Browser", value: blank(auth.accepted_user_agent) },
    ]);
    doc.moveDown(0.4);
  });

  section(
    doc,
    `${(input.esignConsent ? 2 : 1) + input.authorizations.length}. Certified the application`,
    [
      { note: "49 CFR §391.21(b)(12)" },
      // ⚠ On a preview the acts ABOVE are real — the consent and the four authorizations are signed
      // before the form — and this last one has not happened. Saying so in a sentence is the point
      // of the page: four rows of em dashes would read as evidence that failed to record rather
      // than as an act still owed.
      ...(input.preview
        ? [{ note: "Not signed yet. The applicant certifies the answers after the office has approved them." }]
        : [
            { label: "Signed as", value: blank(input.signedName) },
            { label: "Signed", value: stamp(input.certifiedAt) },
            { label: "From address", value: blank(input.applicantIp) },
            { label: "Browser", value: blank(input.applicantUserAgent) },
          ]),
    ],
  );

  rule(doc);
  /**
   * ⚠ The sentence has to name what the footer's digest is actually over, and the third caller made
   * that a parameter rather than a guess. `stampPages` stamps the digest of the SOURCE, and B2's
   * permissions PDF is drawn from the signed rows rather than from the answers — a page telling a
   * reader to match it against "the answers" when the digest is over something else is a claim
   * nobody can check, which on an evidence document is worse than saying nothing.
   */
  const source = opts.source ?? (input.preview ? "answers" : "certified answers");
  muted(
    doc,
    "Each act above is stored with the exact text that was shown at the time, not a reference to "
    + "wording that may since have changed. The identifier in the footer of every page is the digest "
    + `of the ${source} this document was drawn from, so a page can be matched to its source.`,
  );
}
