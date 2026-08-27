import { createHash } from "node:crypto";
import {
  APPLICATION_SECTION_CITATIONS,
  EQUIPMENT_CLASS_LABELS,
  questionnaireByRef,
  readableAnswers,
  type ApplicationEmployer,
  type DriverApplication,
  type QuestionnaireQuestion,
} from "@silvicom/shared";
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
} from "../../../lib/pdfDraw.js";

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
  /**
   * The drawn mark, when the applicant gave one (A8b, D-APP8) — PNG bytes, or null.
   *
   * Decoration, and typed as such: the document renders identically without it, and every place it
   * is drawn already carries the typed name that IS the signature of record. Null is the normal case.
   */
  signatureMark: Buffer | null;
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

/**
 * §391.21(b)(6)'s equipment, laid out as the paragraph and FMCSA's own form both put it.
 *
 * One labelled block per class rather than a five-column grid: the sheet is 612pt wide and a driver's
 * qualification file is read on a screen as often as on paper. `blank()` throughout, because this
 * renders STORED payloads — every application filed before this field existed has none of it, and a
 * derivative that throws on an old payload is a file that cannot be produced.
 */
function equipmentExperience(doc: PDFKit.PDFDocument, rows: ReadonlyArray<Record<string, unknown>>): void {
  if (rows.length === 0) return;
  doc.moveDown(0.3);
  for (const row of rows) {
    const cls = String(row.equipment_class ?? "other") as keyof typeof EQUIPMENT_CLASS_LABELS;
    field(doc, "Equipment", EQUIPMENT_CLASS_LABELS[cls] ?? String(row.equipment_class ?? "—"));
    field(doc, "Type", blank(row.equipment_type as string | null));
    field(doc, "From / to", `${blank(row.from as string)} — ${row.to ? String(row.to) : "present"}`);
    field(doc, "Approximate miles", row.approx_miles == null ? "—" : String(row.approx_miles));
    rule(doc);
  }
}

/**
 * The carrier's own questions and what the driver answered (A9, D-APP12).
 *
 * ── WHY IT IS RENDERED AT ALL, GIVEN "PROJECTED NOWHERE" ──────────────────────────────────────
 * D-APP12 names three places the answers must not reach: `drivers`, `driver_employment_history`, and
 * the DQF item set. This document is none of them — it is a DERIVATIVE of the very payload the
 * answers live in. And it is the only place a recruiter ever sees them: the staff route serves this
 * PDF and nothing else of the application's content, so a questionnaire left out of it would be a
 * form collected and read by nobody.
 *
 * ── WHY IT IS ITS OWN SECTION, AFTER THE REGULATION'S ─────────────────────────────────────────
 * The pages above are numbered §391.21(b)(1)–(12) so a reader with the CFR open can check them line
 * by line. Carrier questions interleaved among them would break exactly that, and would imply the
 * regulation asks for a driver's personal references. So they come last, under the carrier's name,
 * and the heading says whose questions they are.
 *
 * ⚠ THE RESERVED `eeo` KEY NEVER APPEARS HERE. `readableAnswers` drops it, and a test pins that a
 * payload carrying one renders nothing from it: voluntary self-identification must not reach the
 * person deciding the hire, and this document is what that person reads.
 *
 * ⚠ A definition this build no longer carries renders NOTHING rather than throwing. `payload` is
 * historical jsonb — the same rule `blank()` exists for. Answers without their questions are not
 * worth printing anyway: a bare "true" beside no question is not evidence of anything.
 */
function questionnaireSection(doc: PDFKit.PDFDocument, input: ApplicationPdfInput): void {
  const definition = questionnaireByRef(input.application.questionnaire_version);
  if (!definition) return;
  const answers = readableAnswers(input.application.questionnaire_answers as Record<string, unknown>);
  if (Object.keys(answers).length === 0) return;

  doc.addPage();
  heading(doc, `${input.carrier.name} — the carrier's own questions`);
  muted(
    doc,
    `Questionnaire ${definition.id} version ${definition.version}. These questions are the carrier's `
    + "and are not part of 49 CFR §391.21.",
  );
  doc.moveDown(0.3);

  for (const question of definition.questions) {
    const value = answers[question.id];
    if (value === undefined || value === null || value === "") continue;
    if (question.kind === "table") {
      questionnaireTable(doc, question, value);
      continue;
    }
    field(doc, question.label, scalarAnswer(value));
  }
}

const scalarAnswer = (value: unknown): string => {
  if (typeof value === "boolean") return yesNo(value);
  return blank(String(value));
};

/** A table answer, one labelled block per row — a five-column grid on a 612pt sheet is unreadable. */
function questionnaireTable(doc: PDFKit.PDFDocument, question: QuestionnaireQuestion, value: unknown): void {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  if (rows.length === 0) return;
  doc.moveDown(0.3);
  heading(doc, question.label);
  for (const row of rows) {
    for (const column of question.columns ?? []) {
      const cell = row[column.id];
      if (cell === undefined || cell === null || cell === "") continue;
      field(doc, column.label, scalarAnswer(cell));
    }
    rule(doc);
  }
}

/**
 * The drawn mark, beside the name it decorates (A8b, D-APP8).
 *
 * ⚠ Wrapped, and the reason is the whole of D-APP8. pdfkit throws on anything that is not a PNG or a
 * JPEG, and these bytes came from a canvas on a stranger's phone through a bucket. A truncated upload
 * must cost the squiggle and never the document — a §391.51(b)(1) record that cannot be produced
 * because an ornament would not decode is precisely the §390.32(d) failure this renderer exists to
 * prevent.
 *
 * ⚠ And the room check is not politeness. `doc.image` will happily draw below the bottom margin and
 * off the sheet, and the page it would need is not added for it the way pdfkit adds one for text —
 * so a mark that does not fit is simply lost, silently, on whichever instrument happened to have the
 * longest disclosure.
 */
const MARK_WIDTH = 170;
const MARK_HEIGHT = 52;

function drawnMark(doc: PDFKit.PDFDocument, mark: Buffer | null): void {
  if (!mark) return;
  try {
    if (doc.page.height - doc.page.margins.bottom - doc.y < MARK_HEIGHT + 12) doc.addPage();
    doc.image(mark, MARGIN, doc.y, { fit: [MARK_WIDTH, MARK_HEIGHT] });
    doc.x = MARGIN;
    doc.y += MARK_HEIGHT + 6;
  } catch (e) {
    console.warn("[application] the drawn signature mark could not be rendered", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

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
  // ⚠ Not (b)(2) — that paragraph lists name, address, date of birth and social security number and
  // nothing else. Printed here because it belongs beside the name it qualifies, and labelled with the
  // paragraph it actually serves: an employer cannot verify three years for a driver whose former
  // records are under another name (§391.23(a)(2)).
  if ((a.other_names ?? []).length > 0) {
    field(doc, "Also known as", (a.other_names ?? []).join(", "));
  }
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
  // The paragraph asks for two things in one sentence: "the nature and extent of the applicant's
  // experience" — the narrative — and "the type of equipment ... which he/she has operated".
  body(doc, blank(a.experience));
  equipmentExperience(doc, (a.equipment_experience ?? []) as ReadonlyArray<Record<string, unknown>>);

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
  drawnMark(doc, input.signatureMark);
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
    drawnMark(doc, input.signatureMark);
    field(doc, "Date", date(auth.accepted_at));
  }

  // A9: last, under its own heading, after everything the regulation numbers.
  questionnaireSection(doc, input);

  stampFooters(doc, input.signedName, input.applicationId, digest);
  doc.end();
  return done;
}

/** Exported for the section-order test — the citations the rendered document must carry. */
export const RENDERED_CITATIONS = APPLICATION_SECTION_CITATIONS;
