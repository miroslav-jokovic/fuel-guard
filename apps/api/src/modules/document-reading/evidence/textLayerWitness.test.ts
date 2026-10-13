import { beforeAll, describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { emptyShippingDocument, printedHazmatLineSchema, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { normaliseSource, type CanonicalPage } from "../pages/index.js";
import type { TextLayer } from "../pages/canonical.js";
import { shippingEvidence } from "./shippingEvidence.js";
import { textLayerPages, turnBox } from "./textLayerWitness.js";

/**
 * The text layer as a row-bound witness (§7B A4). The PDF is a born-digital BOL drawn with pdfkit and read
 * back through intake's own normaliser (pdf.js), so the boxes are the ones a real read records. Its rows are
 * 0132900's (§7B.2): UN2735 with 6 drums and 11,400 lb, the id printed "UN 2735" with a space as many shipper
 * systems print it, and UN3082 a row below with 24 and its class 9 — the rows as far apart, in line
 * heights, as on the scanned page the OCR fixture copies (shippingEvidence.test.ts).
 */
const line = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);
const doc = (lines: PrintedHazmatLine[]): ShippingDocument => {
  const e = emptyShippingDocument();
  return { ...e, hazmat: { ...e.hazmat, lines } };
};
const UN2735 = { idText: "UN2735", psn: "Amines, liquid, corrosive, n.o.s.", hazardClass: "8", pg: "II" as const, packaging: "DRUMS" };
const UN3082 = { idText: "UN3082", psn: "Environmentally hazardous substance, liquid, n.o.s.", hazardClass: "9", pg: "III" as const };

function bolPdf(): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "LETTER", margin: 0, info: { CreationDate: new Date(0) } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));
  pdf.font("Helvetica").fontSize(9);
  const row = (y: number, count: string, description: string, weight: string) => {
    pdf.text(count, 40, y, { lineBreak: false });
    pdf.text("DR", 70, y, { lineBreak: false });
    pdf.text(description, 110, y, { lineBreak: false });
    pdf.text(weight, 520, y, { lineBreak: false });
  };
  pdf.fontSize(16).text("STRAIGHT BILL OF LADING", 40, 40, { lineBreak: false }).fontSize(9);
  row(300, "6", "UN 2735, Amines, liquid, corrosive, n.o.s., 8, PG II", "11,400");
  row(360, "24", "UN3082, Environmentally hazardous substance, liquid, n.o.s., 9, PG III", "3,806");
  pdf.end();
  return done;
}

const of = (all: ReturnType<typeof shippingEvidence>, path: string, reader: string) =>
  all.find((e) => e.path === path)!.sources.filter((s) => s.reader === reader);

describe("textLayerPages — a born-digital BOL read back through intake", () => {
  let page: CanonicalPage;
  beforeAll(async () => {
    const out = await normaliseSource(await bolPdf(), "application/pdf");
    if (!out.ok) throw new Error(`expected pages, got ${out.code}`);
    page = out.pages[0]!;
  });

  it("records which reader's count and weight the line's own row prints — 6 drums, not Sonnet 4.6's 9", () => {
    const text = textLayerPages([{ textLayer: page.textLayer, rotation: 0 }]);
    const all = shippingEvidence(
      doc([line({ ...UN2735, packageCount: 9, grossWeightLb: 11400 }), line({ ...UN3082, packageCount: 24, grossWeightLb: 3808 })]),
      doc([line({ ...UN2735, packageCount: 6, grossWeightLb: 11400 }), line({ ...UN3082, packageCount: 24, grossWeightLb: 3806 })]),
      "5",
      null,
      text,
    );
    expect(of(all, "hazmat.lines[0].packageCount", "textLayer")).toEqual([{ reader: "textLayer", page: 1, bbox: expect.any(Object), value: 6 }]);
    expect(of(all, "hazmat.lines[0].grossWeightLb", "textLayer").map((s) => s.value)).toEqual([11400]);
    expect(of(all, "hazmat.lines[1].packageCount", "textLayer").map((s) => s.value)).toEqual([24]);
    // 0135071's 3,808 against the printed 3,806: the row backs the second reader.
    expect(of(all, "hazmat.lines[1].grossWeightLb", "textLayer").map((s) => s.value)).toEqual([3806]);
    // The row is the line's band of the page, in fractions, around the printed id.
    const bbox = of(all, "hazmat.lines[0].packageCount", "textLayer")[0]!.bbox!;
    expect(bbox.y).toBeLessThan(300 / 792);
    expect(bbox.y + bbox.h).toBeGreaterThan(300 / 792);
    expect(bbox.y + bbox.h).toBeLessThan(360 / 792);
    // Statuses do not move: Read comes only by graduation (D-DR5).
    expect(all.some((e) => e.status === "read")).toBe(false);
  });

  it("finds an id printed with a space — the words are joined into the line they sit on", () => {
    const [p] = textLayerPages([{ textLayer: page.textLayer, rotation: 0 }])!;
    expect(p!.items.some((i) => /\bUN 2735,/.test(i.text) && i.text.includes("11,400"))).toBe(true);
    expect(p!.items.some((i) => i.text.includes("11,400") && i.text.includes("3,806"))).toBe(false);
  });

  it("is a separate source from the OCR, recorded after it, and absent where it has no text", () => {
    const text = textLayerPages([{ textLayer: page.textLayer, rotation: 0 }]);
    const a = doc([line({ ...UN2735, packageCount: 6 })]);
    const both = shippingEvidence(a, a, "5", text, text);
    expect(of(both, "hazmat.lines[0].packageCount", "ocr").length + of(both, "hazmat.lines[0].packageCount", "textLayer").length).toBe(2);
    const readers = both.find((e) => e.path === "hazmat.lines[0].packageCount")!.sources.map((s) => s.reader);
    expect(readers.slice(-2)).toEqual(["ocr", "textLayer"]);
    expect(shippingEvidence(a, a, "5", text, null).some((e) => e.sources.some((s) => s.reader === "textLayer"))).toBe(false);
  });
});

describe("textLayerPages — which pages it speaks for", () => {
  const word = (text: string, x: number, y: number): TextLayer["words"][number] => ({ text, bbox: { x, y, w: 0.02, h: 0.01 } });
  const layer: TextLayer = { words: [word("UN1263", 0.3, 0.4), word("77", 0.05, 0.4)] };

  it("speaks for all the read pages or none: a scanned or photographed page among them silences it", () => {
    expect(textLayerPages([{ textLayer: layer, rotation: 0 }, { textLayer: layer, rotation: 0 }])).toHaveLength(2);
    expect(textLayerPages([{ textLayer: layer, rotation: 0 }, { textLayer: null, rotation: 0 }])).toBeNull();
    expect(textLayerPages([{ textLayer: { words: [] }, rotation: 0 }])).toBeNull();
    expect(textLayerPages([])).toBeNull();
  });

  it("turns each box the clockwise quarter-turns the page is read at, so the row is found in reading order", () => {
    const b = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };
    expect(turnBox(b, 0)).toEqual(b);
    expect(turnBox(b, 90)).toEqual({ x: 0.75, y: 0.1, w: 0.05, h: 0.3 });
    expect(turnBox(b, 180)).toEqual({ x: 0.6, y: 0.75, w: 0.3, h: 0.05 });
    expect(turnBox(b, 270)).toEqual({ x: 0.2, y: 0.6, w: 0.05, h: 0.3 });
    // A row printed across a sideways page runs down it; turned upright, its id and count share a line again.
    const sideways: TextLayer = { words: [word("UN1263", 0.4, 0.3), word("77", 0.4, 0.05)].map((w) => ({ ...w, bbox: { ...w.bbox, w: 0.01, h: 0.02 } })) };
    const all = shippingEvidence(doc([line({ idText: "UN1263", psn: "Paint", hazardClass: "3", pg: "II", packageCount: 77 })]), null, "5", null,
      textLayerPages([{ textLayer: sideways, rotation: 90 }]));
    expect(of(all, "hazmat.lines[0].packageCount", "textLayer").map((s) => s.value)).toEqual([77]);
  });
});
