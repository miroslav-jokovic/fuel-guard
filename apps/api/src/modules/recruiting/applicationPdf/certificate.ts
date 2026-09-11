import {
  AUTHORIZATION_PURPOSE_LABELS,
  type AuthorizationPurpose,
} from "@silvicom/shared";
import { field, heading, muted, rule } from "../../../lib/pdfDraw.js";
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
export function certificate(doc: PDFKit.PDFDocument, input: ApplicationPdfInput): void {
  doc.addPage();
  heading(doc, "Certificate of completion");
  muted(
    doc,
    "How this application was signed, and what the carrier's system recorded at the moment of each "
    + "act. Every time is the server's, taken when the act was received, and none of it is supplied "
    + "by the signer.",
  );
  doc.moveDown(0.5);

  field(doc, "Application", input.applicationId);
  field(doc, "Signer", blank(input.signedName));
  rule(doc);

  if (input.esignConsent) {
    heading(doc, "1. Agreed to sign electronically");
    muted(doc, `15 U.S.C. 7001(c) · version ${input.esignConsent.disclosure_version}`);
    field(doc, "Agreed", stamp(input.esignConsent.consented_at));
    field(doc, "From address", blank(input.esignConsent.applicant_ip));
    field(doc, "Browser", blank(input.esignConsent.applicant_user_agent));
    doc.moveDown(0.4);
  }

  input.authorizations.forEach((auth, i) => {
    // Numbered from the consent, so the list reads as the order the acts happened in rather than as
    // an unordered set — which is the question "what did they agree to, and when" actually asks.
    heading(doc, `${(input.esignConsent ? 2 : 1) + i}. ${purposeLabel(auth.purpose)}`);
    muted(doc, `Version ${auth.disclosure_version} · method ${auth.method}`);
    field(doc, "Signed as", blank(auth.signed_name));
    field(doc, "Signed", stamp(auth.accepted_at));
    field(doc, "From address", blank(auth.accepted_ip));
    field(doc, "Browser", blank(auth.accepted_user_agent));
    doc.moveDown(0.4);
  });

  heading(doc, `${(input.esignConsent ? 2 : 1) + input.authorizations.length}. Certified the application`);
  muted(doc, "49 CFR §391.21(b)(12)");
  field(doc, "Signed as", blank(input.signedName));
  field(doc, "Signed", stamp(input.certifiedAt));
  field(doc, "From address", blank(input.applicantIp));
  field(doc, "Browser", blank(input.applicantUserAgent));

  rule(doc);
  muted(
    doc,
    "Each act above is stored with the exact text that was shown at the time, not a reference to "
    + "wording that may since have changed. The identifier in the footer of every page is the digest "
    + "of the certified answers this document was drawn from, so a page can be matched to its source.",
  );
}
