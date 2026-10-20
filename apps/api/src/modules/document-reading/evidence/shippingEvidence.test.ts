import { describe, expect, it } from "vitest";
import { emptyShippingDocument, fieldEvidenceSchema, printedHazmatLineSchema, readersAgree, valuesAgree, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { alignLines } from "./alignLines.js";
import { HMT_JUDGED_KEYS } from "./hmtWitness.js";
import { EVIDENCE_FOR } from "./index.js";
import type { OcrPage } from "./rowWitness.js";
import { auditFieldStates } from "./paperAudit.js";
import { shippingEvidence } from "./shippingEvidence.js";

/**
 * Two readers and the table (§7B A3). The cases are the office BOLs' (§7B.2): Sonnet 4.6 read 9 drums where
 * the paper says 6 and 3,808 lb where it says 3,806; the second reader read 6 and 3,806.
 */
const line = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);
const doc = (lines: PrintedHazmatLine[]): ShippingDocument => {
  const e = emptyShippingDocument();
  return { ...e, hazmat: { ...e.hazmat, lines } };
};
const ev = (a: ShippingDocument, b: ShippingDocument | null) => shippingEvidence(a, b, "2");
const at = (all: ReturnType<typeof ev>, path: string) => all.find((e) => e.path === path)!;

const UN2735 = { idText: "UN2735", psn: "Amines, liquid, corrosive, n.o.s.", hazardClass: "8", pg: "II" as const, packaging: "DRUMS" };
const UN3082 = { idText: "UN3082", psn: "Environmentally hazardous substance, liquid, n.o.s.", hazardClass: "9", pg: "III" as const };

describe("valuesAgree", () => {
  it("ignores case, surrounding and repeated space and a thousands comma — and nothing else", () => {
    expect(valuesAgree("DRUMS", " Drums ")).toBe(true);
    expect(valuesAgree("30,452.6", "30452.6")).toBe(true);
    expect(valuesAgree(6, 9)).toBe(false);
    expect(valuesAgree(3806, 3808)).toBe(false);
    expect(valuesAgree("UN1263", "UN1268")).toBe(false);
    expect(valuesAgree(null, 6)).toBe(false);
    expect(valuesAgree(["ERG#128"], ["erg#128"])).toBe(true);
  });

  it("reads a decimal without its trailing zeros, and touches nothing else about the number", () => {
    // production read d0f2831a: the same 48 jerricans, one reader copying the shipper's four decimals
    expect(valuesAgree("48.0000 Non-Removable Head Plastic Jerrican", "48 Non-Removable Head Plastic Jerrican")).toBe(true);
    expect(valuesAgree("5.00 EA", "5 EA")).toBe(true);
    expect(valuesAgree("20,030.00", "20030")).toBe(true);
    expect(valuesAgree("5.50", "5.5")).toBe(true);
    expect(valuesAgree("5.05", "5.5")).toBe(false);
    expect(valuesAgree("48.0001", "48")).toBe(false);
    expect(valuesAgree("480", "48.0")).toBe(false);
    expect(valuesAgree("10.10.2026", "10.1.2026")).toBe(false);
    expect(valuesAgree("1.20.0", "1.2.0")).toBe(false);
    expect(valuesAgree("1.2.10", "1.2.1")).toBe(false);
  });
});

describe("alignLines", () => {
  it("matches lines by the id's digits, not by position, so one dropped line puts one line in doubt", () => {
    const a = [line({ idText: "UN1" }), line({ idText: "UN2" }), line({ idText: "UN3" })];
    const b = [line({ idText: "UN 3" }), line({ idText: "UN1" })];
    const { aligned, extra } = alignLines(a, b);
    expect(aligned.map((l) => l?.idText ?? null)).toEqual(["UN1", null, "UN 3"]);
    expect(extra).toEqual([]);
  });

  it("matches a repeated id nth to nth, and returns a line only B saw as extra", () => {
    const a = [line({ idText: "UN1263", pg: "II" }), line({ idText: "UN1263", pg: "III" })];
    const b = [line({ idText: "UN1263", pg: "II" }), line({ idText: "UN1263", pg: "III" }), line({ idText: "UN1993" })];
    const { aligned, extra } = alignLines(a, b);
    expect(aligned.map((l) => l?.pg)).toEqual(["II", "III"]);
    expect(extra.map((l) => l.idText)).toEqual(["UN1993"]);
  });
});

describe("shippingEvidence", () => {
  it("records both readers on every field: the 9-vs-6 drums disagree, the shared values agree", () => {
    const a = doc([line({ ...UN2735, packageCount: 9, grossWeightLb: 11400 })]);
    const b = doc([line({ ...UN2735, packageCount: 6, grossWeightLb: 11400 })]);
    const all = ev(a, b);
    for (const e of all) expect(fieldEvidenceSchema.parse(e)).toEqual(e);
    expect(readersAgree(at(all, "hazmat.lines[0].packageCount"))).toBe(false);
    expect(at(all, "hazmat.lines[0].packageCount").sources.map((s) => [s.reader, s.value])).toEqual([["passA", 9], ["passB", 6]]);
    expect(readersAgree(at(all, "hazmat.lines[0].grossWeightLb"))).toBe(true);
    expect(readersAgree(at(all, "hazmat.lines[0].packaging"))).toBe(true);
    // The document is pass A's: the value shown is A's until a person picks.
    expect(at(all, "hazmat.lines[0].packageCount").value).toBe(9);
  });

  it("never marks a field Read — agreement waits for graduation (D-DR5) — and marks not_read where both read nothing", () => {
    const a = doc([line({ ...UN2735, packageCount: 6 })]);
    const all = ev(a, a);
    expect(all.some((e) => e.status === "read")).toBe(false);
    expect(at(all, "hazmat.lines[0].packageCount").status).toBe("check");
    expect(at(all, "hazmat.lines[0].technicalName").status).toBe("not_read");
    expect(at(all, "identity.bolNumber").status).toBe("not_read");
  });

  it("keeps the table's verdict on the identifying fields of each line", () => {
    const all = ev(doc([line({ ...UN2735, hazardClass: "3" })]), null);
    for (const k of HMT_JUDGED_KEYS) {
      expect(at(all, `hazmat.lines[0].${k}`).sources.find((s) => s.reader === "table")!.value).toMatchObject({ consistent: false });
    }
    expect(at(all, "hazmat.lines[0].packageCount").sources.some((s) => s.reader === "table")).toBe(false);
  });

  it("records one reader, never agreement, when pass B produced nothing or has no partner line", () => {
    const solo = ev(doc([line({ ...UN2735, packageCount: 6 })]), null);
    expect(readersAgree(at(solo, "hazmat.lines[0].packageCount"))).toBeNull();
    const unpartnered = ev(doc([line({ ...UN2735, packageCount: 6 }), line({ ...UN3082, packageCount: 24 })]), doc([line({ ...UN3082, packageCount: 24 })]));
    expect(readersAgree(at(unpartnered, "hazmat.lines[0].packageCount"))).toBeNull();
    // …while the line B did see is matched by key, though it is B's first and A's second.
    expect(readersAgree(at(unpartnered, "hazmat.lines[1].packageCount"))).toBe(true);
  });

  it("shows a line only pass B saw, after pass A's lines, with B's value and the table's verdict", () => {
    const all = ev(doc([line({ ...UN2735 })]), doc([line({ ...UN2735 }), line({ ...UN3082, packageCount: 24 })]));
    const extra = at(all, "hazmat.lines[1].packageCount");
    expect(extra.sources.map((s) => [s.reader, s.value])).toEqual([["passB", 24]]);
    expect(at(all, "hazmat.lines[1].idText").sources.find((s) => s.reader === "table")!.value).toMatchObject({ consistent: true });
  });

  it("is what a finished shipping-document read records", () => {
    const a = doc([line({ ...UN2735, packageCount: 6 })]);
    expect(EVIDENCE_FOR.shipping_document(a, a, "3", OCR, OCR)).toEqual(shippingEvidence(a, a, "3", OCR, OCR));
    expect(EVIDENCE_FOR.shipping_document(a, a, "3", OCR, OCR)).not.toEqual(shippingEvidence(a, a, "3", OCR, null));
  });
});

// 0132900 as the OCR engine saw it: UN2735's row shows 6 and 11,400; UN3082's, a line below, shows 24 and the class 9.
const box = (text: string, x: number, y: number) => ({ text, box: { x, y, width: 20 * text.length, height: 40 } });
const OCR: OcrPage[] = [{
  page: 1, width: 2550, height: 3300, items: [
    box("UN2735, Amines, liquid, corrosive, n.o.s., 8, PG II", 400, 1000), box("6", 120, 1010), box("11,400", 2100, 1005),
    box("UN3082, Environmentally hazardous substance, liquid, n.o.s., 9, PG III", 400, 1300), box("24", 120, 1310),
  ],
}];
const ocrOf = (all: ReturnType<typeof ev>, path: string) => at(all, path).sources.filter((s) => s.reader === "ocr");

describe("shippingEvidence — the OCR witness (§7B A5)", () => {
  it("records which reader's count the line's own row shows — 0132900's 6 drums, not Sonnet 4.6's 9", () => {
    const all = shippingEvidence(
      doc([line({ ...UN2735, packageCount: 9, grossWeightLb: 11400 }), line({ ...UN3082, packageCount: 24 })]),
      doc([line({ ...UN2735, packageCount: 6, grossWeightLb: 11400 }), line({ ...UN3082, packageCount: 24 })]),
      "3",
      OCR,
    );
    expect(ocrOf(all, "hazmat.lines[0].packageCount")).toEqual([{ reader: "ocr", page: 1, bbox: expect.any(Object), value: 6 }]);
    expect(ocrOf(all, "hazmat.lines[0].grossWeightLb").map((s) => s.value)).toEqual([11400]);
    expect(ocrOf(all, "hazmat.lines[1].packageCount").map((s) => s.value)).toEqual([24]);
    // Status is unchanged by the witness: Read comes only by graduation (D-DR5).
    expect(at(all, "hazmat.lines[0].packageCount").status).toBe("check");
  });

  it("records null when the row shows neither reader's value, and says nothing when every reading is the line's own class", () => {
    const all = shippingEvidence(doc([line({ ...UN2735, packageCount: 9 })]), doc([line({ ...UN2735, packageCount: 7 })]), "3", OCR);
    expect(ocrOf(all, "hazmat.lines[0].packageCount").map((s) => s.value)).toEqual([null]);
    // UN2735 is class 8, and its description prints the 8 on this row: the row can neither back an 8 nor
    // deny it, so it abstains and the count rests on the readers (Mayo BOL 14182's 8 totes, class 8).
    const eight = shippingEvidence(doc([line({ ...UN2735, packageCount: 8 })]), doc([line({ ...UN2735, packageCount: 8 })]), "3", OCR);
    expect(ocrOf(eight, "hazmat.lines[0].packageCount")).toEqual([]);
    expect(auditFieldStates(eight)["hazmat.lines[0].packageCount"]).toBe("read");
    // One provable reading is enough for the row to judge: an 8 against a 6 is backed or refused as before.
    const split = shippingEvidence(doc([line({ ...UN2735, packageCount: 8 })]), doc([line({ ...UN2735, packageCount: 6 })]), "3", OCR);
    expect(ocrOf(split, "hazmat.lines[0].packageCount").map((s) => s.value)).toEqual([6]);
  });

  it("judges only count, weight and quantity — never the identifying fields — and nothing both readers left empty", () => {
    const a = doc([line({ ...UN2735, packageCount: 6, quantity: { value: 6, unit: "DR" } })]);
    const all = shippingEvidence(a, a, "3", OCR);
    const judged = all.filter((e) => e.sources.some((s) => s.reader === "ocr")).map((e) => e.path);
    expect(judged).toEqual(["hazmat.lines[0].quantity.value", "hazmat.lines[0].packageCount"]);
  });

  it("is absent with no OCR, and when the line's id is not on the page", () => {
    const a = doc([line({ ...UN2735, packageCount: 6 }), line({ idText: "5607540", packageCount: 6 })]);
    expect(shippingEvidence(a, a, "3", null).some((e) => e.sources.some((s) => s.reader === "ocr"))).toBe(false);
    expect(ocrOf(shippingEvidence(a, a, "3", OCR), "hazmat.lines[1].packageCount")).toEqual([]);
  });

  it("binds the second of two lines with one id to the second printed row — 0135071's two UN1263 lines", () => {
    const paint = { idText: "UN1263", psn: "Paint", hazardClass: "3", pg: "II" as const };
    const ocr: OcrPage[] = [{ page: 1, width: 2550, height: 3300, items: [
      box("UN1263, PAINT, 3, PG II", 400, 1000), box("77", 120, 1005), box("UN1263, PAINT, 3, PG II", 400, 1600), box("182", 120, 1605),
    ] }];
    const a = doc([line({ ...paint, packageCount: 77 }), line({ ...paint, packageCount: 182 })]);
    const all = shippingEvidence(a, a, "3", ocr);
    expect(ocrOf(all, "hazmat.lines[0].packageCount").map((s) => s.value)).toEqual([77]);
    expect(ocrOf(all, "hazmat.lines[1].packageCount").map((s) => s.value)).toEqual([182]);
  });

  it("binds a line only pass B saw to its own row", () => {
    const all = shippingEvidence(doc([line({ ...UN2735, packageCount: 6 })]), doc([line({ ...UN2735, packageCount: 6 }), line({ ...UN3082, packageCount: 24 })]), "3", OCR);
    expect(ocrOf(all, "hazmat.lines[1].packageCount").map((s) => s.value)).toEqual([24]);
  });
});

describe("shippingEvidence — non-hazmat rows and the paper's totals (Q-DR26, profile 1.3.0)", () => {
  type Other = ShippingDocument["otherLines"][number];
  const other = (description: string, packageCount: number | null, grossWeightLb: number | null): Other => ({ description, packageCount, grossWeightLb });
  const withRows = (lines: PrintedHazmatLine[], rows: Other[], freight: Partial<ShippingDocument["freight"]> = {}): ShippingDocument => {
    const d = doc(lines);
    return { ...d, otherLines: rows, freight: { ...d.freight, weightUnit: "lb", ...freight } };
  };
  const src = (all: ReturnType<typeof ev>, path: string, reader: string) => at(all, path)?.sources.find((s) => s.reader === reader)?.value;

  it("pairs the rows in order when both readers read as many, whatever their wording", () => {
    const a = withRows([], [other("Not Regulated", 178, 3659), other("Not Regulated", 23, 16480)]);
    const b = withRows([], [other("NOT REGULATED (SAP 5348472)", 178, 3659), other("Not regulated", 23, 16480)]);
    const all = ev(a, b);
    expect(readersAgree(at(all, "otherLines[1].grossWeightLb"))).toBe(true);
    expect(readersAgree(at(all, "otherLines[0].description"))).toBe(false);
  });

  it("pairs by an agreeing description when one reader read more rows, and records the row only one saw after the rest", () => {
    const a = withRows([], [other("Paper", 10, 200)]);
    const b = withRows([], [other("Pails", 4, 120), other("Paper", 10, 200)]);
    const all = ev(a, b);
    expect(readersAgree(at(all, "otherLines[0].packageCount"))).toBe(true);
    expect(at(all, "otherLines[1].description").sources.map((s) => s.reader)).toEqual(["passB"]);
    expect(src(all, "otherLines[1].grossWeightLb", "passB")).toBe(120);
  });

  it("records the totals' word on every row's count and weight, hazmat and not", () => {
    const freight = { netWeight: 22046 + 1000, pieces: 20 };
    const a = withRows([line({ ...UN2735, packageCount: 10, grossWeightLb: 1000 })], [other("Not regulated", 10, 22046)], freight);
    const all = ev(a, a);
    expect(src(all, "hazmat.lines[0].grossWeightLb", "arithmetic")).toBe(1000);
    expect(src(all, "otherLines[0].grossWeightLb", "arithmetic")).toBe(22046);
    expect(src(all, "otherLines[0].packageCount", "arithmetic")).toBe(10);
    expect(fieldEvidenceSchema.array().parse(all)).toHaveLength(all.length);
  });

  it("adds no totals' word when only the hazmat section is given", () => {
    const all = shippingEvidence({ hazmat: doc([line({ ...UN2735, grossWeightLb: 1000 })]).hazmat }, null, "7");
    expect(all.flatMap((e) => e.sources).some((s) => s.reader === "arithmetic")).toBe(false);
  });
});

describe("the table judges both readings of a line the readers read differently (RC3)", () => {
  const ACID = { psn: "CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (PHOSPHORIC ACID, SULFURIC ACID)", hazardClass: "8", pg: "II" as const, packageCount: 38, grossWeightLb: 2052 };
  it("pairs UN3254 / UN3264 as one line, the id in dispute, and records which reading the table matches", () => {
    const all = ev(doc([line({ idText: "UN3254", ...ACID })]), doc([line({ idText: "UN3264", ...ACID })]));
    expect(all.filter((e) => e.path.startsWith("hazmat.lines[1]"))).toEqual([]);
    const id = at(all, "hazmat.lines[0].idText");
    expect(readersAgree(id)).toBe(false);
    const table = id.sources.find((s) => s.reader === "table")!.value as { consistent: boolean; passB?: { consistent: boolean; hmtRef?: string } };
    expect(table.consistent).toBe(false);
    expect(table.passB).toMatchObject({ consistent: true, hmtRef: expect.stringMatching(/^UN3264-/) });
  });
  it("adds no second verdict when the readers read the line alike", () => {
    const all = ev(doc([line({ idText: "UN3264", ...ACID })]), doc([line({ idText: "UN3264", ...ACID })]));
    expect(at(all, "hazmat.lines[0].idText").sources.find((s) => s.reader === "table")!.value).not.toHaveProperty("passB");
  });
});
