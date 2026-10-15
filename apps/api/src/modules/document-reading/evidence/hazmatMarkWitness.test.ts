import { describe, expect, it } from "vitest";
import { emptyShippingDocument, fieldEvidenceSchema, printedHazmatLineSchema, rowWitnessesBack } from "@silvicom/shared";
import { hazmatMarks } from "./hazmatMarkWitness.js";
import type { OcrItem, OcrPage } from "./rowWitness.js";
import { shippingEvidence } from "./shippingEvidence.js";

/**
 * The page scan behind "No hazardous materials" (hazmatMarkWitness.ts). The freight page is drawn after the
 * owner's first production read (5614b556, 2026-10-13): a produce BOL — lettuce for Walmart — with an HM
 * column header and nothing under it. Boxes are pixels of a 2550 × 3300 page.
 */
const item = (text: string, x: number, y: number, width = 20 * text.length): OcrItem => ({ text, box: { x, y, width, height: 40 } });
const page = (items: OcrItem[], n = 1): OcrPage => ({ page: n, width: 2550, height: 3300, items });

const PRODUCE = [
  item("HM", 100, 900, 60),
  item("DESCRIPTION OF ARTICLES", 400, 900),
  item("WEIGHT", 2100, 900),
  item("ICEBERG LETTUCE 24 CT", 400, 1000),
  item("22 PLT", 1700, 1000),
  item("38,400", 2100, 1000),
  item("NAME: X. SANCHEZ", 1500, 3000),
];

describe("hazmatMarks", () => {
  it("finds nothing on a produce BOL that prints an empty HM column", () => {
    expect(hazmatMarks([page(PRODUCE)])).toEqual([]);
  });

  it("finds a UN or NA number printed with a space, on any page, with the page it is on", () => {
    const marks = hazmatMarks([page(PRODUCE), page([item("NA 1993, Diesel fuel, 3, PG III", 400, 1100)], 2)]);
    expect(marks.map((m) => [m.mark, m.page])).toEqual([["NA1993", 2]]);
    expect(marks[0]!.bbox.y).toBeCloseTo(1100 / 3300);
  });

  it("does not take a four-digit number or a product code for an id", () => {
    expect(hazmatMarks([page([...PRODUCE, item("1993", 400, 1100), item("SUN1263 PALLET", 400, 1200)])])).toEqual([]);
  });

  it("finds RQ anywhere and an X standing alone under the HM header — not an X elsewhere on the page", () => {
    const marks = hazmatMarks([page([...PRODUCE, item("X", 110, 1100), item("X", 1200, 1100), item("RQ (Toluene)", 400, 1200)])]);
    expect(marks.map((m) => m.mark)).toEqual(["X", "RQ"]);
  });

  it("finds no HM-column X on a page with no HM header", () => {
    expect(hazmatMarks([page([item("X", 110, 1100)])])).toEqual([]);
  });
});

describe("shippingEvidence — the scan on a read with no hazmat line", () => {
  const line = printedHazmatLineSchema.parse({ idText: "UN1993", psn: "Flammable liquid, n.o.s.", hazardClass: "3", pg: "II" });
  const none = emptyShippingDocument();

  it("records each engine's marks on hazmat.lines: [] backs the empty list, a UN number on the page does not", () => {
    const clean = shippingEvidence(none, none, "6", [page(PRODUCE)], null).find((e) => e.path === "hazmat.lines")!;
    expect(fieldEvidenceSchema.parse(clean)).toEqual(clean);
    expect(clean.sources.map((s) => [s.reader, s.value])).toEqual([["passA", []], ["passB", []], ["ocr", []]]);
    expect(rowWitnessesBack(clean)).toBe(true);

    const missed = shippingEvidence(none, none, "6", [page([...PRODUCE, item("UN1993", 400, 1300)])], [page([item("UN 1993", 400, 1300)])])
      .find((e) => e.path === "hazmat.lines")!;
    expect(missed.sources.filter((s) => s.reader !== "passA" && s.reader !== "passB").map((s) => [s.reader, s.value, s.page])).toEqual([
      ["ocr", ["UN1993"], 1],
      ["textLayer", ["UN1993"], 1],
    ]);
    expect(rowWitnessesBack(missed)).toBe(false);
  });

  it("records no scan when there was no OCR, and none on a read that has hazmat lines", () => {
    expect(shippingEvidence(none, none, "6", null, null).find((e) => e.path === "hazmat.lines")!.sources.map((s) => s.reader)).toEqual(["passA", "passB"]);
    const hazmat = { ...none, hazmat: { ...none.hazmat, lines: [line] } };
    expect(shippingEvidence(hazmat, hazmat, "6", [page(PRODUCE)], null).some((e) => e.path === "hazmat.lines")).toBe(false);
  });
});
