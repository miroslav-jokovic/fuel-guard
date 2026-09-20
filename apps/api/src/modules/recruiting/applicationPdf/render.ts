import { createHash } from "node:crypto";
import {
  APPLICATION_PROGRESS_LABELS,
  APPLICATION_SECTION_CITATIONS,
  EQUIPMENT_CLASS_LABELS,
  type ApplicationDraftPayload,
  type ApplicationEmployer,
  type ApplicationProgressState,
} from "@silvicom/shared";
import { certificate } from "./certificate.js";
import { consentPage, drawnMark, instrumentPage } from "./instrumentPages.js";
import { questionnaireSection } from "./questionnairePage.js";
import { stampPages } from "./stamp.js";
import {
  body,
  caption,
  field,
  heading,
  muted,
  newDrawing,
  rule,
  title,
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
  /**
   * The answers, as they are STORED — which is why the type is the draft's and not the certified
   * document's (F6).
   *
   * ⚠ Widened deliberately, and it takes nothing away: every scalar on this page already goes through
   * `blank()` and every list through `?? []`, because `driver_applications.payload` is historical
   * jsonb and a row filed before some later field has none of it. A filed `DriverApplication` is
   * assignable to this. What it BUYS is the office's preview: the same renderer over
   * `application_drafts.payload`, which is the same document with fewer of its answers given yet.
   */
  application: ApplicationDraftPayload;
  applicationId: string;
  /**
   * Server-stamped, never client-supplied (D-APP9). This is §391.21(b)(4).
   *
   * Null on a preview: nothing has been submitted, and a date here would be the one fact on the page
   * that is not true yet.
   */
  certifiedAt: string | null;
  /** The name that was certified with. Empty on a preview — nobody has signed anything. */
  signedName: string;
  applicantIp: string | null;
  /** The browser the certification itself was made from. Stored since 0220 and never printed. */
  applicantUserAgent: string | null;
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
    /**
     * ⚠ The three columns `record_driver_release` has always written and this document never
     * printed (X7). `driver_authorizations` stores eight facts per signature and `file.ts` was
     * selecting five of them — so the carrier held a better evidentiary record than the document it
     * files could show, which is the wrong way round for a §391.51 file.
     */
    method: string;
    accepted_ip: string | null;
    accepted_user_agent: string | null;
  }>;
  /**
   * What this rendering IS: the filed document (null), or the office's preview of one nobody has
   * certified (F6).
   *
   * ── WHY THE PREVIEW IS THE SAME RENDERER AND NOT A SECOND ONE ─────────────────────────────────
   * The office needs to read, print and post an application while the driver is still filling it in —
   * and what they need to read is the document that will be filed, not a second rendering of the same
   * answers that could drift from it. A separate draft renderer would be a second source of truth
   * about what a §391.21 application looks like, and the labels would drift first.
   *
   * The `stage` is carried so the page can say where it has got to in the office's own words
   * (`APPLICATION_PROGRESS_LABELS` — the reader of a preview is the recruiter who asked for it).
   */
  preview: { stage: ApplicationProgressState } | null;
  /** The 15 U.S.C. 7001(c) consent behind the whole electronic record (A4), when one was given. */
  esignConsent: {
    disclosure_version: string;
    disclosure_text: string;
    intent_statement: string;
    consented_at: string;
    applicant_ip: string | null;
    applicant_user_agent: string | null;
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
    // ⚠ `blank()` and not a null check: a DRAFT holds the unanswered number as an empty STRING (the
    // form's own control value), which is not null and printed as nothing at all on the preview.
    field(doc, "Approximate miles", blank(row.approx_miles == null ? null : String(row.approx_miles)));
    rule(doc);
  }
}

/** The digest of what this page was drawn from — see the header on why it is not the file's own. */
export const sourceDigest = (application: ApplicationDraftPayload, applicationId: string): string =>
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

export async function renderApplicationPdf(input: ApplicationPdfInput): Promise<Buffer> {
  const a = input.application;
  // Buffered: the footer names the page number out of the total, which is not known until the last
  // instrument page has been drawn.
  const { doc, done } = newDrawing(`Driver application — ${input.signedName}`, { bufferPages: true });
  const digest = sourceDigest(a, input.applicationId);

  title(doc, "Driver employment application");
  // ⚠ The FIRST line a reader sees says which of the two documents this is. A preview that opened
  // "Completed and certified by the applicant" would be a lie on the one page everybody reads.
  // ⚠ `caption`, not `muted`: it is the title's lede and owns the air between itself and the rule
  // below it, so it reads as belonging to the title rather than floating between the two (AUD-8).
  caption(
    doc,
    input.preview
      ? "49 CFR §391.21. A PREVIEW of an application in progress. Nothing on it has been certified, "
        + "and it is not part of any qualification file. Where it has got to: "
        + `${APPLICATION_PROGRESS_LABELS[input.preview.stage].toLowerCase()}.`
      : "49 CFR §391.21. Completed and certified by the applicant.",
  );
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
  // ⚠ The same sentence (b)(8) and (b)(10) print, for the same reason (H8, AUD-11): a heading with
  // nothing under it is the one thing this document must never say, because a reader cannot tell it
  // from a section that was never asked. ⚠ And "Not answered." rather than a declared none: there is
  // no `declares_no_addresses` in the contract and there should not be — everybody has an address,
  // so an empty list here is an omission and can only be one.
  if ((a.addresses ?? []).length === 0) body(doc, "Not answered.");
  for (const addr of a.addresses ?? []) {
    field(
      doc,
      `${blank(addr.from)} — ${addr.to ?? "present"}`,
      [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", "),
    );
  }

  // (b)(4) — the submission date, server-stamped. Never a field on the form (D-APP9).
  paragraph(doc, "§391.21(b)(4)", "Date submitted");
  // ⚠ "Not submitted yet" rather than the em dash `date(null)` would give. An empty date on a
  // §391.21 form reads as a field somebody forgot to fill in; this one is not owed yet.
  field(doc, "Submitted", input.preview ? "Not submitted yet" : date(input.certifiedAt));

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
  //
  // ⚠ **Which is why a silence here needs TWO sentences, and AUD-11 is the reason they exist.** This
  // block used to be `body(blank(a.experience))` followed by a loop that returns on an empty list —
  // so an unanswered section printed a lone em dash and nothing else, and an answered narrative with
  // no equipment printed as though the paragraph had one half. A dash under a heading is not an
  // answer; it is the absence of one, wearing the costume of a value.
  //
  // ⚠ Each sentence QUOTES the half of the paragraph it is about rather than saying "Not answered."
  // twice. Two identical sentences under one heading tell a reader that something is missing and not
  // what; the regulation has already named both halves, so the document borrows its words.
  // ⚠ And when BOTH are missing it is one sentence, the same "Not answered." the other sections use
  // — the section as a whole is unanswered, and saying it twice would read as two separate faults.
  const experience = (a.experience ?? "").trim();
  const equipment = (a.equipment_experience ?? []) as ReadonlyArray<Record<string, unknown>>;
  if (experience === "" && equipment.length === 0) {
    body(doc, "Not answered.");
  } else {
    body(doc, experience === "" ? "The nature and extent of the experience was not answered." : experience);
    if (equipment.length === 0) body(doc, "The type of equipment operated was not answered.");
    else equipmentExperience(doc, equipment);
  }

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
  // ⚠ The mark is the applicant's own and belongs only to an act they have performed. A preview has
  // no certification, so it gets no squiggle beside one — a drawn signature under an uncertified
  // statement is the one thing on this page that could be mistaken for evidence.
  if (!input.preview) drawnMark(doc, input.signatureMark);
  field(doc, "Date", input.preview ? "—" : date(input.certifiedAt));
  if (input.applicantIp) field(doc, "Signed from", input.applicantIp);
  muted(
    doc,
    input.preview
      ? "NOT SIGNED. The applicant makes this certification themselves, on their own device, after "
        + "the office has approved the answers above — so this block is empty on a preview and will "
        + "carry their name, the moment they signed and the address they signed from on the filing."
      : "Signed electronically under 49 CFR §390.32 and the ESIGN Act. The date is recorded by the "
        + "carrier's system at the moment of signing and is not supplied by the signer.",
  );

  // The 7001(c) consent, and then one page per instrument — each showing the text that was signed.
  // ⚠ Both pages are drawn by `instrumentPages.ts`, which B2's permissions PDF draws them with too.
  // They are the pages a dispute is about (FCRA §604(b)(2) asks which wording was shown), so they are
  // the last place two implementations should exist — A2 is what a second one costs.
  if (input.esignConsent) consentPage(doc, input.esignConsent);
  for (const auth of input.authorizations) instrumentPage(doc, auth, input.signatureMark);

  // A9: last, under its own heading, after everything the regulation numbers.
  questionnaireSection(doc, input);

  // ⚠ After the questionnaire and before the footers: the certificate is about the DOCUMENT, so it
  // reads as an appendix rather than as another thing the applicant answered.
  certificate(doc, input);

  stampPages(doc, {
    // The applicant, not the signer — on a preview there is no signer, and a loose sheet still has to
    // say who it is about. `first_name`/`last_name` are the same two fields the name block prints.
    name: blank([a.first_name, a.last_name].filter(Boolean).join(" ")),
    // ⚠ "invitation" on a preview, because that is what the id IS — there is no `driver_applications`
    // row until the driver certifies. A footer calling it an application id would send whoever chased
    // it to a table with no such row.
    reference: input.preview
      ? `preview of invitation ${input.applicationId}`
      : `application ${input.applicationId}`,
    digest,
    // Said in words on every sheet, because a preview gets printed, photocopied and posted, and the
    // sheet that ends up in somebody's hands has to carry its own status (D-AVI22's reasoning).
    band: input.preview ? "DRAFT - NOT A SIGNED APPLICATION" : null,
  });
  doc.end();
  return done;
}

/** Exported for the section-order test — the citations the rendered document must carry. */
export const RENDERED_CITATIONS = APPLICATION_SECTION_CITATIONS;
