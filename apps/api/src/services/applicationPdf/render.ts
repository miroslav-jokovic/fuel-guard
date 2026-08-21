import { createHash } from "node:crypto";
import {
  APPLICATION_SECTION_CITATIONS,
  type ApplicationEmployer,
  type DriverApplication,
} from "@fuelguard/shared";
import {
  CONTENT_WIDTH,
  MARGIN,
  MUTED,
  PAGE_HEIGHT,
  body,
  field,
  heading,
  muted,
  newDrawing,
  rule,
  title,
  winAnsi,
} from "../dqBinder/pdfDraw.js";

/**
 * The §391.21 application, as the document the regulation describes (A6, D-APP9).
 *
 * ── WHY THERE IS A RENDERED DOCUMENT AT ALL ────────────────────────────────────────────────────
 * The evidence is the payload and the signed rows; this is a DERIVATIVE of them. What it exists for
 * is that §391.51(b)(1) requires the application to be IN the qualification file, §390.32(d) requires
 * an electronic record to be "accurately reproducible", and an auditor asking to see the application
 * a driver signed should be handed one document rather than a database. If the renderer improves, a
 * new PDF is a new `documents` row and the evidence never moved (D-PSP2's rule applied to our own
 * document).
 *
 * ── THE ORDER IS THE REGULATION'S, NOT THE FORM'S ─────────────────────────────────────────────
 * §391.21(b)(1) through (b)(12), in that sequence, each block naming the paragraph it discharges — so
 * a reader with the CFR open can check the document the way they would check a paper one. That is
 * also why (b)(4) is a printed date and not a field: it is the submission date, stamped server-side,
 * and D-APP9 forbids taking one from a client.
 *
 * ── WHAT THE FOOTER CARRIES, AND THE ONE THING IT CANNOT ──────────────────────────────────────
 * ⚠ A6's text asks for the sha256 in the footer. That is impossible as written: the hash of a file
 * cannot be inside the file — changing the footer changes the bytes, which changes the hash. What the
 * footer carries instead is the digest of the SOURCE: the certified payload the page was drawn from,
 * which is stable, meaningful and exactly what "this page identifies its own source" needs to mean
 * for a derivative. The hash of the bytes still exists, on the `documents` row, where it can be.
 */

export interface ApplicationPdfInput {
  carrier: { name: string; address: string | null };
  application: DriverApplication;
  applicationId: string;
  /** Server-stamped, never client-supplied (D-APP9). This is §391.21(b)(4). */
  certifiedAt: string;
  signedName: string;
  applicantIp: string | null;
  /** One page each, in the order they were signed. */
  authorizations: ReadonlyArray<{
    purpose: string;
    disclosure_version: string;
    disclosure_text: string;
    intent_statement: string;
    signed_name: string;
    accepted_at: string;
  }>;
  /** The 15 U.S.C. 7001(c) consent behind the whole electronic record (A4), when one was given. */
  esignConsent: {
    disclosure_version: string;
    disclosure_text: string;
    intent_statement: string;
    consented_at: string;
  } | null;
}

/**
 * A date, or an em dash.
 *
 * Nullable on purpose rather than by accident: `isoDateSchema` and `dateOfBirthSchema` are nullish in
 * the contract, and a rendered document must print what the applicant actually answered — a blank
 * where they left one — instead of throwing and producing no document at all.
 */
const date = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "—");
const yesNo = (v: boolean): string => (v ? "Yes" : "No");
/**
 * A value, or an em dash.
 *
 * ⚠ Every scalar goes through this, including the ones the contract marks required — because this
 * renderer reads STORED payloads, and `driver_applications.payload` is historical jsonb. A row filed
 * before A3a has no `additional_licences`; a row filed before some future field has none of that
 * either. The document must render what was actually certified, gaps and all: a derivative that
 * throws on an old payload is a qualification file that cannot be produced, which is precisely the
 * §390.32(d) failure the PDF exists to prevent.
 */
const blank = (v: string | null | undefined): string => (v && v.trim() !== "" ? v : "—");

/** The digest of what this page was drawn from — see the header on why it is not the file's own. */
export const sourceDigest = (application: DriverApplication, applicationId: string): string =>
  createHash("sha256").update(`${applicationId}:${JSON.stringify(application)}`, "utf8").digest("hex");

function paragraph(doc: PDFKit.PDFDocument, cite: string, label: string): void {
  heading(doc, `${cite} — ${label}`);
}

function employerBlock(doc: PDFKit.PDFDocument, e: ApplicationEmployer): void {
  field(doc, "Employer", blank(e.employer_name));
  field(doc, "Address", [e.address_line1, e.city, e.state].filter(Boolean).join(", ") || "—");
  field(doc, "USDOT", blank(e.usdot_number));
  field(doc, "Position", blank(e.position_held));
  field(doc, "From / to", `${date(e.started_on)} — ${e.ended_on ? date(e.ended_on) : "present"}`);
  field(doc, "Drove a CMV", yesNo(e.operated_cmv));
  field(doc, "DOT-regulated", yesNo(e.dot_regulated));
  field(doc, "Reason for leaving", blank(e.reason_for_leaving));
  rule(doc);
}

/**
 * Every page says who it is about and which application it belongs to.
 *
 * ⚠ The bottom margin is dropped to zero while these are written and restored afterwards. pdfkit
 * treats any text drawn below the bottom margin as content that has overflowed and AUTO-ADDS A PAGE
 * for it — so a footer stamped at the foot of the sheet silently doubles the document, and the new
 * blank pages arrive after `bufferedPageRange()` was read, so the count printed on them is wrong too.
 * It presents as "every page added two pages", which is how it was found.
 */
function stampFooters(doc: PDFKit.PDFDocument, name: string, applicationId: string, digest: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        winAnsi(`${name} · application ${applicationId} · source ${digest.slice(0, 16)} · page ${i - range.start + 1} of ${range.count}`),
        MARGIN,
        PAGE_HEIGHT - MARGIN - 6,
        { width: CONTENT_WIDTH, lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
}

export async function renderApplicationPdf(input: ApplicationPdfInput): Promise<Buffer> {
  const a = input.application;
  // Buffered: the footer names the page number out of the total, which is not known until the last
  // instrument page has been drawn.
  const { doc, done } = newDrawing(`Driver application — ${input.signedName}`, { bufferPages: true });
  const digest = sourceDigest(a, input.applicationId);

  title(doc, "Driver employment application");
  muted(doc, "49 CFR §391.21. Completed and certified by the applicant.");
  rule(doc);

  // (b)(1) — the carrier. Not an applicant field: the server prints what the server knows (D-APP9).
  paragraph(doc, "§391.21(b)(1)", "Employing motor carrier");
  field(doc, "Carrier", blank(input.carrier.name));
  // ⚠ Printed only when the carrier has supplied one. The regulation asks for the address and the
  // column is nullable (0229) precisely so a missing owner input costs one line rather than the
  // whole document; §6 tracks the ask.
  if (input.carrier.address) field(doc, "Address", input.carrier.address);

  paragraph(doc, "§391.21(b)(2)", "Applicant");
  field(doc, "Name", blank([a.first_name, a.middle_name, a.last_name].filter(Boolean).join(" ")));
  field(doc, "Date of birth", date(a.date_of_birth));
  field(doc, "Email", blank(a.email));
  field(doc, "Phone", blank(a.phone));
  // The Social Security number is deliberately NOT printed. §391.21(b)(2) lists it and D-HIRE6 keeps
  // the last four sealed away from every projection; a rendered document that a recruiter emails is
  // the last place nine digits should appear.

  paragraph(doc, "§391.21(b)(3)", "Addresses for the past 3 years");
  for (const addr of a.addresses ?? []) {
    field(
      doc,
      `${blank(addr.from)} — ${addr.to ?? "present"}`,
      [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", "),
    );
  }

  // (b)(4) — the submission date, server-stamped. Never a field on the form (D-APP9).
  paragraph(doc, "§391.21(b)(4)", "Date submitted");
  field(doc, "Submitted", date(input.certifiedAt));

  paragraph(doc, "§391.21(b)(5)", "Licences and permits held");
  field(doc, "Licence", blank(a.cdl_number ? `${a.cdl_number} (${blank(a.cdl_state)})` : null));
  field(doc, "Class", blank(a.cdl_class));
  field(doc, "Expires", date(a.cdl_expires_at));
  for (const l of a.additional_licences ?? []) {
    field(doc, blank(l.issuing_authority), `${blank(l.number)} · expires ${date(l.expires_at)}${l.kind ? ` · ${l.kind}` : ""}`);
  }

  paragraph(doc, "§391.21(b)(6)", "Experience and equipment");
  body(doc, blank(a.experience));

  paragraph(doc, "§391.21(b)(7)", "Accidents in the past 3 years");
  if ((a.accidents ?? []).length === 0) {
    // An empty list is an ANSWER, and the document says which answer it is (H8's rule).
    body(doc, a.declares_no_accidents ? "The applicant declared no accidents." : "Not answered.");
  }
  for (const acc of a.accidents ?? []) {
    field(doc, date(acc.occurred_on), blank(acc.nature));
    field(doc, "Fatalities / injuries", `${acc.fatalities} / ${acc.injuries}`);
    field(doc, "Hazmat spill", yesNo(acc.hazmat_spill));
    rule(doc);
  }

  paragraph(doc, "§391.21(b)(8)", "Traffic convictions in the past 3 years");
  if ((a.violations ?? []).length === 0) {
    body(doc, a.declares_no_violations ? "The applicant declared no convictions." : "Not answered.");
  }
  for (const v of a.violations ?? []) {
    field(doc, date(v.occurred_on), `${blank(v.offence)}${v.state ? ` (${v.state})` : ""}${v.penalty ? ` — ${v.penalty}` : ""}`);
  }

  paragraph(doc, "§391.21(b)(9)", "Licence denied, revoked or suspended");
  body(doc, a.licence_ever_denied ? blank(a.licence_denial_detail) : "The applicant declared none.");

  paragraph(doc, "§391.21(b)(10) and (b)(11)", "Employment history");
  if ((a.employers ?? []).length === 0) {
    body(doc, a.declares_no_employment ? "The applicant declared no employment." : "Not answered.");
  }
  for (const e of a.employers ?? []) employerBlock(doc, e);

  // (b)(12) — the certification, and the sentence the regulation puts at the end of the form.
  doc.addPage();
  paragraph(doc, "§391.21(b)(12)", "Certification");
  body(
    doc,
    "This certifies that this application was completed by me, and that all entries on it and "
    + "information in it are true and complete to the best of my knowledge.",
  );
  doc.moveDown(0.6);
  field(doc, "Signed", blank(input.signedName));
  field(doc, "Date", date(input.certifiedAt));
  if (input.applicantIp) field(doc, "Signed from", input.applicantIp);
  muted(
    doc,
    "Signed electronically under 49 CFR §390.32 and the ESIGN Act. The date is recorded by the "
    + "carrier's system at the moment of signing and is not supplied by the signer.",
  );

  // The 7001(c) consent, and then one page per instrument — each showing the text that was signed.
  if (input.esignConsent) {
    doc.addPage();
    heading(doc, "Consent to transact electronically");
    muted(doc, `15 U.S.C. 7001(c) · version ${input.esignConsent.disclosure_version}`);
    body(doc, blank(input.esignConsent.disclosure_text));
    doc.moveDown(0.5);
    body(doc, blank(input.esignConsent.intent_statement));
    field(doc, "Agreed", date(input.esignConsent.consented_at));
  }

  for (const auth of input.authorizations) {
    doc.addPage();
    heading(doc, `Authorization — ${auth.purpose}`);
    muted(doc, `Version ${auth.disclosure_version}`);
    // The exact text that was signed, from the row, not from today's constant: a document showing
    // current wording beside an old signature would misrepresent what somebody agreed to.
    body(doc, blank(auth.disclosure_text));
    doc.moveDown(0.5);
    body(doc, blank(auth.intent_statement));
    doc.moveDown(0.4);
    field(doc, "Signed", blank(auth.signed_name));
    field(doc, "Date", date(auth.accepted_at));
  }

  stampFooters(doc, input.signedName, input.applicationId, digest);
  doc.end();
  return done;
}

/** Exported for the section-order test — the citations the rendered document must carry. */
export const RENDERED_CITATIONS = APPLICATION_SECTION_CITATIONS;
