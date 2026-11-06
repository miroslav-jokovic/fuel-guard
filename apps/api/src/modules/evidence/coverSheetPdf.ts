import PDFDocument from "pdfkit";
import { encode, toSvgPath } from "@silvicom/qr";
import { formatCoverSheetPayload, formatDisplayDate } from "@silvicom/shared";
import { pdfkitText, useUnicodeFonts } from "../../lib/pdfFonts.js";

/**
 * One scan cover sheet per driver, one letter page each (DRIVER-PAPER-INTAKE-PLAN PI1, Q-PI2 (a)).
 *
 * ── WHAT THE PAGE IS FOR ─────────────────────────────────────────────────────────────────────────
 * It goes on top of a driver's paper folder; the stack goes through the office's Brother feeder
 * scanner (Q-PI1); intake (PI2) finds the QR and cuts the file there. So the page is designed for a
 * scanner first and a person second:
 * - The symbol is large (3½") and centred, ECC-H (`encode`'s default, labelPdf.ts's reasoning): a
 *   300 dpi grayscale scan of a creased, re-used sheet still reads.
 * - Nothing else on the page is a barcode, so intake never has to choose between two.
 * - The name is the largest text, so the person stacking folders checks the right sheet is on the
 *   right folder without reading anything small. The names are Unicode (`useUnicodeFonts`): Silvicom's
 *   drivers include names with č, ć, š, which WinAnsi would print as `?`.
 *
 * `printedOn` is a parameter, not a clock read, so the same input renders the same page (memory
 * `labelpdf-flake-is-an-indirect-timestamp`); pdfkit's own CreationDate is pinned for the same reason.
 */
export interface CoverSheetDriver {
  id: string;
  fullName: string;
  employeeId: string | null;
  hireDate: string | null;
}

const PAGE = { width: 612, height: 792, margin: 54 } as const;
const SYMBOL = 252; // 3.5 in

export async function renderCoverSheets(drivers: readonly CoverSheetDriver[], printedOn: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    info: { Title: "Driver file scan cover sheets", CreationDate: new Date(`${printedOn}T12:00:00Z`) },
    autoFirstPage: false,
  });
  useUnicodeFonts(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const width = PAGE.width - PAGE.margin * 2;
  for (const d of drivers) {
    doc.addPage();
    const text = (s: string) => pdfkitText(doc, s);
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11)
      .text(text("DRIVER QUALIFICATION FILE · SCAN COVER SHEET"), PAGE.margin, PAGE.margin, { width, align: "center" });

    doc.font("Helvetica-Bold").fontSize(30).text(text(d.fullName), PAGE.margin, 110, { width, align: "center" });
    const facts = [d.employeeId ? `Employee ID ${d.employeeId}` : null, d.hireDate ? `Hired ${formatDisplayDate(d.hireDate)}` : null]
      .filter(Boolean).join("   ·   ");
    if (facts) doc.font("Helvetica").fontSize(13).text(text(facts), PAGE.margin, doc.y + 8, { width, align: "center" });

    const payload = formatCoverSheetPayload(d.id);
    const x = (PAGE.width - SYMBOL) / 2;
    const y = 230;
    doc.save().translate(x, y).fillColor("#000000").path(toSvgPath(encode(payload), { size: SYMBOL })).fill().restore();
    doc.font("Helvetica").fontSize(8).fillColor("#444444").text(payload, PAGE.margin, y + SYMBOL + 6, { width, align: "center" });

    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(13).text(text("How to use this sheet"), PAGE.margin, 560, { width });
    doc.font("Helvetica").fontSize(12);
    for (const line of [
      "1. Put this sheet on top of this driver's papers, face up.",
      "2. Remove staples and clips. Every page after this sheet, up to the next cover sheet, is filed to this driver.",
      "3. Scan the stack as one PDF: 300 dpi, grayscale, both sides.",
      "4. Upload it on Drivers › Upload scanned files. Nothing is filed until somebody checks it.",
    ]) doc.text(text(line), PAGE.margin, doc.y + 6, { width });

    doc.font("Helvetica").fontSize(9).fillColor("#666666")
      .text(text(`Printed ${formatDisplayDate(printedOn)} · Silvicom 360`), PAGE.margin, PAGE.height - PAGE.margin - 12, { width, align: "center", lineBreak: false });
  }

  doc.end();
  return done;
}
