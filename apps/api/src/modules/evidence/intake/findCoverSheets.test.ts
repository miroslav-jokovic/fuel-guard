import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { renderCoverSheets } from "../coverSheetPdf.js";
import { coverSheetOnImage, findCoverSheets } from "./findCoverSheets.js";
import sharp from "sharp";
import { openPdf, paintPdfPage } from "../../../lib/pdfRaster.js";
import { pdfPageTexts } from "../../../testing/pdfText.js";

/**
 * PI1's done-when: a printed cover sheet, found again in a scanned stack, names its driver. The
 * round trip runs through the real encoder, renderer, rasteriser and decoder — nothing stubbed — so
 * a change to any of them that would stop a sheet reading turns this red.
 */
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const drivers = [
  { id: A, fullName: "Marko Petrović", employeeId: "E-104", hireDate: "2019-03-01" },
  { id: B, fullName: "Ann Driver", employeeId: null, hireDate: null },
];

/** Two lettered paper pages, standing in for a driver's application and MVR. */
async function paperPages(n: number): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  for (let i = 0; i < n; i++) doc.addPage().fontSize(14).text(`Employment application page ${i + 1}`, 72, 72);
  doc.end();
  return done;
}

describe("driver scan cover sheets (PI1)", () => {
  it("prints one page per driver, in the order asked, with the name the stacker checks", async () => {
    const pdf = await renderCoverSheets(drivers, "2026-11-06");
    const pages = await pdfPageTexts(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Marko Petrović");
    expect(pages[0]).toContain("Employee ID E-104");
    expect(pages[0]).toContain("Hired 03/01/2019");
    expect(pages[1]).toContain("Ann Driver");
    expect(pages[1]).not.toContain("Employee ID");
    expect(pages[0]).toContain("Printed 11/06/2026");
  });

  it("is found again in the stack, page by page, naming each driver", async () => {
    const { PDFDocument: Lib } = await import("pdf-lib");
    const sheets = await Lib.load(await renderCoverSheets(drivers, "2026-11-06"));
    const papers = await Lib.load(await paperPages(3));
    // Stack: sheet A, two papers, sheet B, one paper — how the office feeds folders through.
    const stack = await Lib.create();
    const [sa, sb] = await stack.copyPages(sheets, [0, 1]);
    const [p1, p2, p3] = await stack.copyPages(papers, [0, 1, 2]);
    for (const p of [sa!, p1!, p2!, sb!, p3!]) stack.addPage(p);
    const found = await findCoverSheets(Buffer.from(await stack.save()));
    expect(found).toEqual({ ok: true, pageCount: 5, sheets: [{ page: 1, driverId: A }, { page: 4, driverId: B }] });
  }, 60_000);

  it("finds no sheet in a file of papers alone", async () => {
    expect(await findCoverSheets(await paperPages(2))).toEqual({ ok: true, pageCount: 2, sheets: [] });
  }, 60_000);

  it("refuses bytes that are not a PDF rather than reporting no sheets", async () => {
    expect(await findCoverSheets(Buffer.from("not a pdf"))).toMatchObject({ ok: false });
  });

  it("still reads a sheet the way a feeder scanner returns it: tilted, soft, grayscale JPEG at 200 dpi", async () => {
    const opened = await openPdf(await renderCoverSheets(drivers, "2026-11-06"));
    if (!opened.ok) throw new Error("render failed");
    const page = await opened.doc.getPage(1);
    const painted = await paintPdfPage(page, 200 / 72);
    await opened.close();
    const scanned = await sharp(painted.data, { raw: { width: painted.width, height: painted.height, channels: 3 } })
      .rotate(3, { background: "#ffffff" })
      .blur(1.2)
      .grayscale()
      .jpeg({ quality: 55 })
      .toBuffer();
    expect(await coverSheetOnImage(await sharp(scanned).png().toBuffer())).toBe(A);
  }, 60_000);
});
