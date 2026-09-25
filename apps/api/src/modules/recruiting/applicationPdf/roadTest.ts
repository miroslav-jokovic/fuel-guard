import {
  ROAD_TEST_ITEMS,
  ROAD_TEST_RATINGS,
  ROAD_TEST_RATING_LABELS,
  ROAD_TEST_TRAILER_LABELS,
  formatDisplayDate,
  type RoadTestRating,
  type RoadTestRecord,
} from "@silvicom/shared";
import { CONTENT_WIDTH, INK, MARGIN, MUTED, newDrawing, pdfkitText } from "../../../lib/pdfDraw.js";

/**
 * The carrier's road-test paper, filled in — D2 (`ROAD-TEST-PLAN.md` RT2, D-HM7).
 *
 * ── TWO DOCUMENTS, BECAUSE §391.31(g) FILES TWO ───────────────────────────────────────────────
 * The DQF keeps "the original signed road test form" and "the original, or a copy of, the
 * certificate", and the driver is given the certificate. So `roadTestFormPdf` draws the carrier's
 * DRIVER'S ROAD TEST EXAMINATION and EVALUATION OF ROAD TEST — the ratings, whatever they were — and
 * `roadTestCertificatePdf` draws the CERTIFICATE OF ROAD TEST alone, which exists only for a pass.
 * The driver's copy is then exactly the document §391.31(g) says they get, and nothing about their
 * ratings.
 *
 * ── THE CARRIER'S WORDS, NOT OURS ─────────────────────────────────────────────────────────────
 * Titles, captions and sentences are the carrier's form (`docs/Kowlage-Base/Road Test
 * Examination.docx`) as written, `Operator's or Chauffeur's Lic. No.` and `breaking` included
 * (D-PKT11). The pre-printed values on it — `2021 FRHT`, `DRY VAN/REEFER`, a year of `2021`, `15`
 * miles, `SILVICOM` — are NOT printed: each is a field now, filled from the roster, the record and the
 * examiner. The letterhead is `organizations.legal_address`, which on 2026-09-25 read exactly the
 * form's three lines.
 *
 * ⚠ The examiner's signature is a picture the OFFICE added (Q-RT2), so each page also prints who
 * recorded the test. The examiner's judgement and the hand that applied their signature are two
 * facts, and a reader of the filed page must be able to see both.
 */

export interface RoadTestExaminerPrint {
  fullName: string;
  title: string;
  /** The PNG the office added. Null prints the typed name on the signature line instead. */
  signature: Buffer | null;
}

export interface RoadTestDocumentInput {
  carrier: { name: string; address: string | null };
  driver: {
    fullName: string;
    address: { line1: string | null; city: string | null; state: string | null; zip: string | null };
    phone: string | null;
    licenceNumber: string | null;
    licenceState: string | null;
  };
  /** "2021 FRHT #1234" — year, make, unit, as the carrier's form writes a power unit. */
  powerUnit: string;
  record: RoadTestRecord;
  examiner: RoadTestExaminerPrint;
  /** The office user who recorded the test and applied the examiner's signature (Q-RT2). */
  recordedBy: string;
}

const TITLE_SIZE = 13;
const BODY_SIZE = 10;
const SMALL = 8;

function letterhead(doc: PDFKit.PDFDocument, carrier: RoadTestDocumentInput["carrier"]): void {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12)
    .text(pdfkitText(doc, carrier.name), MARGIN, doc.y, { width: CONTENT_WIDTH, align: "right" });
  // The street on one line and the rest on the next, as the carrier's form prints it:
  // "1301 Armitage Ave" / "Melrose Park, IL 60160". Split at the FIRST comma only.
  const address = carrier.address ?? "";
  const cut = address.indexOf(",");
  const lines = cut < 0 ? [address] : [address.slice(0, cut), address.slice(cut + 1)];
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    doc.font("Helvetica").fontSize(BODY_SIZE)
      .text(pdfkitText(doc, line), MARGIN, doc.y, { width: CONTENT_WIDTH, align: "right" });
  }
  doc.moveDown(1.5);
}

function title(doc: PDFKit.PDFDocument, words: string): void {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(TITLE_SIZE)
    .text(pdfkitText(doc, words), MARGIN, doc.y, { width: CONTENT_WIDTH, align: "center" });
  doc.moveDown(1.2);
}

/**
 * `Caption: value` on one line, the value on a rule — the shape of every blank on the carrier's form.
 * ⚠ The value shrinks to fit rather than wrapping, for `permissionInstrument.ts`'s `onRule` reason: a
 * wrapped value overprints the next line of the paper.
 */
function blank(doc: PDFKit.PDFDocument, caption: string, value: string, x = MARGIN, width = CONTENT_WIDTH): void {
  const y = doc.y;
  doc.fillColor(INK).font("Helvetica").fontSize(BODY_SIZE);
  const cap = pdfkitText(doc, `${caption} `);
  const capWidth = doc.widthOfString(cap);
  doc.text(cap, x, y, { lineBreak: false });
  const ruleX = x + capWidth;
  const ruleWidth = width - capWidth;
  doc.strokeColor(INK).lineWidth(0.5).moveTo(ruleX, y + BODY_SIZE + 1).lineTo(ruleX + ruleWidth, y + BODY_SIZE + 1).stroke();
  const v = pdfkitText(doc, value);
  let size = BODY_SIZE + 1;
  doc.font("Helvetica-Bold");
  while (size > 6 && doc.fontSize(size).widthOfString(v) > ruleWidth - 6) size -= 0.5;
  doc.fillColor(INK).fontSize(size).text(v, ruleX + 3, y + (BODY_SIZE + 1 - size), { lineBreak: false });
  doc.x = MARGIN;
  doc.y = y + BODY_SIZE + 9;
}

/** The examiner's signature on its rule: the picture the office added, or the typed name. */
function signature(doc: PDFKit.PDFDocument, caption: string, examiner: RoadTestExaminerPrint, x: number, width: number): void {
  const y = doc.y;
  doc.fillColor(INK).font("Helvetica").fontSize(BODY_SIZE);
  const cap = pdfkitText(doc, `${caption} `);
  const capWidth = doc.widthOfString(cap);
  const lineY = y + 28;
  doc.text(cap, x, lineY - BODY_SIZE - 1, { lineBreak: false });
  doc.strokeColor(INK).lineWidth(0.5).moveTo(x + capWidth, lineY).lineTo(x + width, lineY).stroke();
  let drawn = false;
  if (examiner.signature) {
    try {
      doc.image(examiner.signature, x + capWidth + 4, y, { fit: [width - capWidth - 8, 26], valign: "bottom" });
      drawn = true;
    } catch (e) {
      // A bad upload costs the picture, never the document: the typed name is printed instead.
      console.warn("[road-test] the examiner's signature image could not be drawn", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (!drawn) {
    doc.font("Helvetica-Oblique").fontSize(12)
      .text(pdfkitText(doc, examiner.fullName), x + capWidth + 4, lineY - 14, { lineBreak: false });
  }
  doc.x = MARGIN;
  doc.y = lineY + 6;
}

/** `Signature: ___ Date: ___` on one line — the carrier's form pairs them everywhere. */
function signedAndDated(doc: PDFKit.PDFDocument, caption: string, input: RoadTestDocumentInput): void {
  const top = doc.y;
  signature(doc, caption, input.examiner, MARGIN, CONTENT_WIDTH * 0.62);
  const after = doc.y;
  doc.y = top + 17;
  blank(doc, "Date:", formatDisplayDate(input.record.tested_on, ""), MARGIN + CONTENT_WIDTH * 0.66, CONTENT_WIDTH * 0.34);
  doc.y = Math.max(after, doc.y);
}

/** The line that makes an office-applied signature traceable (Q-RT2). Small, never hidden. */
function recordedNote(doc: PDFKit.PDFDocument, input: RoadTestDocumentInput): void {
  doc.moveDown(0.6);
  doc.fillColor(MUTED).font("Helvetica").fontSize(SMALL).text(
    pdfkitText(
      doc,
      `Examiner's signature applied from the carrier's file by ${input.recordedBy}, who recorded this test in Silvicom 360.`,
    ),
    MARGIN, doc.y, { width: CONTENT_WIDTH },
  );
}

const mark = (rating: RoadTestRating | undefined, is: RoadTestRating): string => (rating === is ? "X" : "");

function examination(doc: PDFKit.PDFDocument, input: RoadTestDocumentInput): void {
  const { driver, record } = input;
  letterhead(doc, input.carrier);
  title(doc, "DRIVER’S ROAD TEST EXAMINATION");
  blank(doc, "Driver’s Name:", driver.fullName);
  blank(doc, "Address:", driver.address.line1 ?? "");
  const y = doc.y;
  blank(doc, "City:", driver.address.city ?? "", MARGIN, CONTENT_WIDTH * 0.5);
  doc.y = y;
  blank(doc, "State:", driver.address.state ?? "", MARGIN + CONTENT_WIDTH * 0.52, CONTENT_WIDTH * 0.2);
  doc.y = y;
  blank(doc, "Zip:", driver.address.zip ?? "", MARGIN + CONTENT_WIDTH * 0.74, CONTENT_WIDTH * 0.26);
  blank(doc, "Phone:", driver.phone ?? "", MARGIN, CONTENT_WIDTH * 0.6);
  doc.moveDown(0.6);

  doc.fillColor(INK).font("Helvetica").fontSize(BODY_SIZE).text(
    pdfkitText(
      doc,
      "The motor carrier shall give the road test, or a person designated by it. However, another person must give a driver who is a motor carrier the test. A person who is competent to evaluate and determine whether the person who takes the test has demonstrated that he or she is capable of operating the vehicle and associated equipment that the motor carrier intends to assign shall give the test.",
    ),
    MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1.5 },
  );
  doc.moveDown(0.8);
  doc.font("Helvetica").text(pdfkitText(doc, "The road test given includes:"), MARGIN, doc.y);
  doc.moveDown(0.4);
  itemTable(doc, record);
  doc.moveDown(0.6);
  blank(doc, "Type of equipment used in giving test:",
    `${input.powerUnit} with ${ROAD_TEST_TRAILER_LABELS[record.trailer_type].toLowerCase()} trailer`);
  signedAndDated(doc, "Examiner’s Signature:", input);
}

/**
 * The items, each with the three ratings (§391.31(d): the examiner RATES each). The carrier's paper
 * has one blank per item; the owner ruled Q-RT1 that each is rated in the Evaluation's own words.
 */
function itemTable(doc: PDFKit.PDFDocument, record: RoadTestRecord): void {
  const labelWidth = CONTENT_WIDTH - 3 * 62;
  const cols = ROAD_TEST_RATINGS.map((r, i) => ({ r, x: MARGIN + labelWidth + i * 62 }));
  doc.font("Helvetica-Bold").fontSize(SMALL).fillColor(INK);
  const headY = doc.y;
  for (const c of cols) {
    doc.text(pdfkitText(doc, ROAD_TEST_RATING_LABELS[c.r]), c.x, headY, { width: 62, align: "center" });
  }
  doc.y = headY + 14;
  for (const item of ROAD_TEST_ITEMS) {
    const y = doc.y;
    doc.font("Helvetica").fontSize(BODY_SIZE - 0.5).fillColor(INK)
      .text(pdfkitText(doc, item.text), MARGIN, y, { width: labelWidth - 8 });
    const bottom = doc.y;
    for (const c of cols) {
      doc.rect(c.x + 25, y + 1, 11, 11).lineWidth(0.5).strokeColor(INK).stroke();
      const m = mark(record.items[item.key], c.r);
      if (m) doc.font("Helvetica-Bold").fontSize(10).text(m, c.x + 25, y + 1.5, { width: 11, align: "center" });
    }
    doc.y = Math.max(bottom, y + 14) + 3;
  }
  doc.x = MARGIN;
}

function evaluation(doc: PDFKit.PDFDocument, input: RoadTestDocumentInput): void {
  const { record } = input;
  doc.moveDown(1.2);
  title(doc, "EVALUATION OF ROAD TEST");
  const y = doc.y;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(BODY_SIZE).text("GENERAL PERFORMANCE:", MARGIN, y, { lineBreak: false });
  let x = MARGIN + 140;
  for (const r of ROAD_TEST_RATINGS) {
    doc.font("Helvetica").fontSize(BODY_SIZE).text(pdfkitText(doc, ROAD_TEST_RATING_LABELS[r]), x, y, { lineBreak: false });
    const w = doc.widthOfString(ROAD_TEST_RATING_LABELS[r]);
    doc.rect(x + w + 4, y - 1, 11, 11).lineWidth(0.5).strokeColor(INK).stroke();
    if (record.general_performance === r) doc.font("Helvetica-Bold").text("X", x + w + 4, y, { width: 11, align: "center" });
    x += w + 30;
  }
  doc.x = MARGIN;
  doc.y = y + 20;
  doc.font("Helvetica-Bold").fontSize(BODY_SIZE).text("REMARKS:", MARGIN, doc.y);
  doc.font("Helvetica").fontSize(BODY_SIZE)
    .text(pdfkitText(doc, record.remarks?.trim() || "None."), MARGIN, doc.y + 2, { width: CONTENT_WIDTH, lineGap: 1.5 });
  doc.moveDown(0.6);
  blank(doc, "QUALIFIED FOR:", record.qualified_for?.trim() ?? "");
  signedAndDated(doc, "Signature of Examiner:", input);
}

/** Examination + evaluation: the "original signed road test form" §391.31(g) files, pass or fail. */
export async function roadTestFormPdf(input: RoadTestDocumentInput): Promise<Buffer> {
  const { doc, done } = newDrawing(`Road test examination — ${input.driver.fullName}`);
  examination(doc, input);
  doc.addPage();
  letterhead(doc, input.carrier);
  evaluation(doc, input);
  recordedNote(doc, input);
  doc.end();
  return done;
}

/**
 * The §391.31(e)/(f) certificate. Only ever called for a pass — `roadTestPassed` is the caller's
 * gate, and this function does not re-decide it.
 */
export async function roadTestCertificatePdf(input: RoadTestDocumentInput): Promise<Buffer> {
  const { doc, done } = newDrawing(`Certificate of road test — ${input.driver.fullName}`);
  const { driver, record, examiner } = input;
  letterhead(doc, input.carrier);
  title(doc, "CERTIFICATE OF ROAD TEST");
  blank(doc, "Driver’s name:", driver.fullName);
  const y = doc.y;
  blank(doc, "Operator’s or Chauffeur’s Lic. No.", driver.licenceNumber ?? "", MARGIN, CONTENT_WIDTH * 0.72);
  doc.y = y;
  blank(doc, "State", driver.licenceState ?? "", MARGIN + CONTENT_WIDTH * 0.75, CONTENT_WIDTH * 0.25);
  const y2 = doc.y;
  blank(doc, "Type of Power Unit", input.powerUnit, MARGIN, CONTENT_WIDTH * 0.55);
  doc.y = y2;
  blank(doc, "Type of Trailer", ROAD_TEST_TRAILER_LABELS[record.trailer_type].toUpperCase(),
    MARGIN + CONTENT_WIDTH * 0.58, CONTENT_WIDTH * 0.42);
  doc.moveDown(0.8);
  doc.fillColor(INK).font("Helvetica").fontSize(BODY_SIZE).text(
    pdfkitText(
      doc,
      `This is to certify that above named driver was given a road test under my supervision on ${formatDisplayDate(record.tested_on, "")} consisting of approximately ${record.miles} miles of driving.`,
    ),
    MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1.5 },
  );
  doc.moveDown(0.6);
  doc.text(
    pdfkitText(doc, "It is my considered opinion that this driver possesses sufficient driving skills to operate safely the type of commercial motor vehicle listed above."),
    MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1.5 },
  );
  doc.moveDown(1.2);
  const sy = doc.y;
  signature(doc, "Signature of Examiner:", examiner, MARGIN, CONTENT_WIDTH * 0.62);
  const after = doc.y;
  doc.y = sy + 17;
  blank(doc, "Title:", examiner.title, MARGIN + CONTENT_WIDTH * 0.66, CONTENT_WIDTH * 0.34);
  doc.y = Math.max(after, doc.y);
  blank(doc, "Organization of examiner:", input.carrier.name.toUpperCase());
  // §391.31(f) asks for the examiner's ADDRESS as well; the carrier's form lets the letterhead carry it.
  // Printed here too, so the certificate says it even if the letterhead is cut off a copy.
  blank(doc, "Address:", input.carrier.address ?? "");
  recordedNote(doc, input);
  doc.end();
  return done;
}
