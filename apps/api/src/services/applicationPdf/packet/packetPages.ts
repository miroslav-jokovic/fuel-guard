import type { DriverApplication, EquipmentClass } from "@silvicom/shared";
import { CONTENT_WIDTH, INK, MARGIN, MUTED, table, winAnsi, type Cell } from "../../dqBinder/pdfDraw.js";
import { CONTINUED, P1, P2, P12, P16, P26 } from "./packetText.js";
import {
  PACKET_ROW_OF,
  blank,
  cols,
  date,
  fixedTable,
  foldedType,
  line,
  sectionHeading,
  yesNo,
} from "./packetDraw.js";

/**
 * One function per packet page we fill (P4).
 *
 * Split out of `renderPacket.ts` when it crossed the 500-line budget, and split HERE rather than
 * anywhere else because a page is the unit somebody reviews: a person holding the carrier's paper
 * copy checks one page at a time, and the function they need should be findable by its number.
 */

export function page1(doc: PDFKit.PDFDocument, a: DriverApplication, certifiedAt: string): void {
  sectionHeading(doc, P1.heading);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(winAnsi(P1.intro), MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  doc.moveDown(0.6);
  doc.x = MARGIN;

  line(doc, P1.date, date(certifiedAt));
  line(doc, P1.dob, date(a.date_of_birth));
  // ⚠ The Social Security number is NOT printed, and the label is still drawn so the form matches the
  // paper. D-HIRE6 seals it everywhere; a rendered document a recruiter emails is the last place nine
  // digits should appear. `questionnaireByRef` supplies the position, which is the carrier's own
  // question (A9/D-APP12), not a §391.21 field.
  line(doc, P1.ssn, "");
  line(doc, P1.position, answer(a, "position"));
  line(doc, P1.name, [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(" "));
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(winAnsi(P1.nameParts), MARGIN + 150, doc.y, { width: CONTENT_WIDTH - 150 });
  doc.moveDown(0.4);
  doc.x = MARGIN;

  const [current, ...previous] = a.addresses ?? [];
  line(doc, P1.address, current ? addressLine(current) : "");
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(winAnsi(P1.addressParts), MARGIN + 150, doc.y, { width: CONTENT_WIDTH - 150 });
  doc.moveDown(0.5);
  doc.x = MARGIN;

  sectionHeading(doc, P1.residency);
  // ⚠ Three printed lines in the packet, and `addresses` is unbounded — see `fixedTable`.
  fixedTable(
    doc,
    cols([120, 220, 90, 74], ["DATES FROM / TO", "STREET", "CITY", "STATE / ZIP"]),
    previous.map((addr) => [
      { text: `${blank(addr.from)} — ${addr.to ?? "present"}` },
      { text: blank(addr.line1) + (addr.line2 ? `, ${addr.line2}` : "") },
      { text: blank(addr.city) },
      { text: `${blank(addr.state)} ${blank(addr.postal_code)}`.trim() },
    ]),
    3,
  );

  doc.moveDown(0.5);
  line(doc, P1.cdl, `${blank(a.cdl_number)}${a.cdl_state ? ` (${a.cdl_state})` : ""}`);
  line(doc, P1.phone, blank(a.phone));
  line(doc, P1.legallyWork, yesNo(bool(a, "legally_work")));
  line(doc, P1.proofOfAge, yesNo(bool(a, "proof_of_age")));
  line(doc, P1.contactEmployers, yesNo(bool(a, "may_contact_employers")));
  line(doc, P1.heardFrom, answer(a, "heard_from"));
}

/** Page 2 — licences, experience, accidents, convictions, licence history. */
export function page2(doc: PDFKit.PDFDocument, a: DriverApplication): void {
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(winAnsi(P2.oneLicence), MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  doc.moveDown(0.5);
  doc.x = MARGIN;

  const licences: Cell[][] = [
    [
      { text: blank(a.cdl_state) },
      { text: blank(a.cdl_number) },
      { text: blank(a.cdl_class) },
      { text: date(a.cdl_expires_at) },
    ],
    ...(a.additional_licences ?? []).map((l): Cell[] => [
      { text: blank(l.issuing_authority) },
      { text: blank(l.number) },
      { text: blank(l.kind) },
      { text: date(l.expires_at) },
    ]),
  ];
  fixedTable(doc, cols([90, 160, 130, 124], [...P2.licenceColumns]), licences, 3);

  sectionHeading(doc, P2.experienceHeading);
  const byRow = new Map<number, { type: string; from: string; to: string; miles: string }>();
  for (const e of a.equipment_experience ?? []) {
    const cls = (e.equipment_class ?? "other") as EquipmentClass;
    const idx = PACKET_ROW_OF[cls] ?? 3;
    // First entry wins the printed row; the rest reach the continuation, so nothing is dropped.
    if (byRow.has(idx)) continue;
    byRow.set(idx, {
      type: foldedType(cls, e.equipment_type),
      from: blank(e.from),
      to: e.to ? String(e.to) : e.from ? "present" : "",
      miles: e.approx_miles == null ? "" : String(e.approx_miles),
    });
  }
  table(
    doc,
    cols([150, 170, 110, 74], [...P2.experienceColumns]),
    P2.experienceRows.map((label, i): Cell[] => {
      const v = byRow.get(i);
      return [
        { text: label, bold: true },
        { text: v?.type ?? "" },
        { text: v ? `${v.from} — ${v.to}`.trim() : "" },
        { text: v?.miles ?? "" },
      ];
    }),
  );
  const extra = (a.equipment_experience ?? []).length - byRow.size;
  if (extra > 0) {
    doc.moveDown(0.4);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text(winAnsi(`${CONTINUED} (${extra} more)`), MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.3);
    table(
      doc,
      cols([150, 170, 110, 74], [...P2.experienceColumns]),
      (a.equipment_experience ?? []).slice(byRow.size).map((e): Cell[] => {
        const cls = (e.equipment_class ?? "other") as EquipmentClass;
        return [
          { text: P2.experienceRows[PACKET_ROW_OF[cls] ?? 3] ?? "OTHER" },
          { text: foldedType(cls, e.equipment_type) },
          { text: `${blank(e.from)} — ${e.to ? String(e.to) : "present"}` },
          { text: e.approx_miles == null ? "" : String(e.approx_miles) },
        ];
      }),
    );
  }

  sectionHeading(doc, P2.accidentsHeading);
  fixedTable(
    doc,
    cols([80, 190, 74, 66, 94], [...P2.accidentColumns]),
    a.declares_no_accidents
      ? []
      : (a.accidents ?? []).map((x): Cell[] => [
          { text: date(x.occurred_on) },
          { text: blank(x.nature) },
          { text: String(x.fatalities ?? 0) },
          { text: String(x.injuries ?? 0) },
          { text: x.hazmat_spill ? "Yes" : "No" },
        ]),
    3,
  );

  sectionHeading(doc, P2.violationsHeading);
  fixedTable(
    doc,
    cols([100, 190, 110, 104], [...P2.violationColumns]),
    a.declares_no_violations
      ? []
      : (a.violations ?? []).map((x): Cell[] => [
          { text: date(x.occurred_on) },
          { text: blank(x.offence) },
          { text: blank(x.state) },
          { text: blank(x.penalty) },
        ]),
    3,
  );

  doc.moveDown(0.6);
  // ⚠ The packet asks A and B separately; the contract has ONE field, `licence_ever_denied`, whose own
  // wording covers "denied, revoked or suspended". Both lines therefore take the same answer, and the
  // detail is printed once under whichever was answered yes. Splitting the contract to match the form
  // would be changing what the driver is ASKED, which is D-PKT4's other half and counsel's.
  line(doc, P2.deniedQuestion, yesNo(a.licence_ever_denied));
  line(doc, P2.revokedQuestion, yesNo(a.licence_ever_denied));
  if (a.licence_ever_denied) line(doc, P2.explain, blank(a.licence_denial_detail));
}

/** Page 12 — the ten-year background verification log. */
export function page12(doc: PDFKit.PDFDocument, a: DriverApplication): void {
  sectionHeading(doc, P12.heading);
  table(
    doc,
    cols([110, 100, 130, 80, 84], [...P12.identityColumns]),
    [
      [
        { text: blank(a.last_name) },
        { text: blank(a.first_name) },
        { text: (a.other_names ?? []).join(", ") },
        { text: date(a.date_of_birth) },
        // Sealed, exactly as on page 1.
        { text: "" },
      ],
    ],
  );

  doc.moveDown(0.6);
  fixedTable(
    doc,
    cols([104, 130, 130, 84, 56], [...P12.logColumns]),
    a.declares_no_employment
      ? []
      : (a.employers ?? []).map((e): Cell[] => [
          { text: `${date(e.started_on)} — ${e.ended_on ? date(e.ended_on) : "present"}` },
          { text: blank(e.employer_name) },
          { text: [e.address_line1, e.city, e.state].filter(Boolean).join(", ") },
          { text: blank(e.position_held) },
          { text: blank(e.phone) },
        ]),
    3,
  );
}

/** Page 16 — education, military, other training, references. */
export function page16(doc: PDFKit.PDFDocument, a: DriverApplication): void {
  sectionHeading(doc, P16.heading);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(winAnsi(P16.intro), MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  doc.moveDown(0.5);
  doc.x = MARGIN;

  const education = rows(a, "education");
  fixedTable(
    doc,
    cols([150, 80, 130, 70, 74], [...P16.educationColumns]),
    education.map((r): Cell[] => [
      { text: blank(str(r.school)) },
      { text: blank(str(r.years_completed)) },
      { text: blank(str(r.field_of_study)) },
      { text: r.graduated === true ? "Yes" : r.graduated === false ? "No" : "" },
      { text: blank(str(r.graduated_when)) },
    ]),
    3,
  );

  doc.moveDown(0.6);
  line(doc, P16.military, yesNo(bool(a, "military_service")));
  line(doc, P16.militaryWhen, answer(a, "military_when"));

  sectionHeading(doc, P16.training);
  doc.fillColor(INK).font("Helvetica").fontSize(9.5);
  doc.text(winAnsi(answer(a, "other_training") || "—"), MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.x = MARGIN;

  sectionHeading(doc, P16.referencesIntro);
  fixedTable(
    doc,
    cols([220, 130, 154], [...P16.referenceColumns]),
    rows(a, "references").map((r): Cell[] => [
      { text: blank(str(r.full_name ?? r.name)) },
      { text: blank(str(r.years_known)) },
      { text: blank(str(r.phone ?? r.phone_number)) },
    ]),
    3,
  );
}

/**
 * Page 26 — §40.25(j)'s two-year question (P8).
 *
 * ⚠ It renders only because the contract now HOLDS the answer. Until P8 this page was deliberately
 * absent: the plan's inventory said the data was already collected and it was not, and drawing the
 * page with an unanswered checkbox would have put a blank mandatory question inside a document
 * somebody signs — the same defect as silently truncating a table.
 *
 * ⚠ `null` still happens, and means something different from "no". Applications filed before P8 have
 * no answer and `driver_applications` is append-only, so they can never be back-filled. Those render
 * with NEITHER box marked and a line saying so, because a document that showed an unticked "NO" for a
 * question nobody was asked would be asserting something the applicant never said.
 */
export function page26(doc: PDFKit.PDFDocument, a: DriverApplication, signedName: string): void {
  line(doc, P26.nameLabel, signedName);
  doc.moveDown(0.4);
  doc.fillColor(INK).font("Helvetica").fontSize(9.5);
  doc.text(winAnsi(P26.question), MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.4);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
  doc.text(winAnsi(P26.check), MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.5);
  doc.x = MARGIN;

  const answered = a.prior_failed_pre_employment_test;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11);
  doc.text(
    winAnsi(
      `${answered === true ? "[X]" : "[ ]"}  ${P26.yes}      ${answered === false ? "[X]" : "[ ]"}  ${P26.no}`,
    ),
    MARGIN,
    doc.y,
    { width: CONTENT_WIDTH },
  );
  if (answered === null || answered === undefined) {
    doc.moveDown(0.4);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text(winAnsi(P26.notAsked), MARGIN, doc.y, { width: CONTENT_WIDTH });
  }
  doc.moveDown(1.2);
  doc.x = MARGIN;
  // ⚠ The signature LINE is drawn and left empty. P5 places the marks and is blocked on counsel —
  // `isDraftDisclosure()` refuses a signature under `v0-draft` wording on every write path. Drawing a
  // name here without a signing record behind it would be a document claiming a signature nobody gave.
  line(doc, P26.signature, "");
}

// ── questionnaire helpers ─────────────────────────────────────────────────────────────────────
// The carrier's own questions (A9, D-APP12) are answered into `questionnaire_answers`, keyed by
// question id and never projected onto `drivers`. Read defensively: a payload filed before A9 has no
// questionnaire at all, and this renderer must still produce a document from it.

const answersOf = (a: DriverApplication): Record<string, unknown> =>
  (a.questionnaire_answers ?? {}) as Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const answer = (a: DriverApplication, id: string): string => str(answersOf(a)[id]);
const bool = (a: DriverApplication, id: string): boolean | null => {
  const v = answersOf(a)[id];
  return typeof v === "boolean" ? v : null;
};
const rows = (a: DriverApplication, id: string): Array<Record<string, unknown>> => {
  const v = answersOf(a)[id];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
};

const addressLine = (addr: {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
}): string =>
  [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ");

/** The packet page number each rendered page carries in its footer (see `packetFooter`). */
