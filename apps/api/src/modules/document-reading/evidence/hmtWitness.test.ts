import { describe, expect, it } from "vitest";
import { emptyShippingDocument, fieldEvidenceSchema, printedHazmatLineSchema, type PrintedHazmatLine } from "@silvicom/shared";
import { HMT_JUDGED_KEYS, hmtEvidence, hmtVerdict } from "./hmtWitness.js";
import { EVIDENCE_FOR } from "./index.js";

/**
 * The table as a witness (§7B A2). The lines are the ones read LIVE from the ten office BOLs on
 * 2026-10-11 (§7B.2), with the values each model gave — so the test is the measurement, kept.
 */
const line = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);

/** 0135071, Haiku 5.5: the shipper's product codes in the id column. */
const PRODUCT_CODE_LINES = [
  line({ idText: "5607540", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "5608714", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "5503610", psn: "PAINT", hazardClass: "3", pg: "III" }),
  line({ idText: "5348477", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "5503615", psn: "PAINT", hazardClass: "3", pg: "II" }),
];
/** The same paper as Sonnet 4.6 and 5.5 read it, plus lines from the other papers — every one correct. */
const CORRECT_LINES = [
  line({ idText: "UN3077", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "UN3082", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "UN1263", psn: "PAINT", hazardClass: "3", pg: "II" }),
  line({ idText: "UN2735", psn: "Amines, liquid, corrosive, n.o.s.", hazardClass: "8", pg: "II" }),
  line({ idText: "UN2775", psn: null, hazardClass: "6.1", pg: "II" }),
  line({ idText: "UN2876", psn: null, hazardClass: "6.1", pg: "III" }),
  line({ idText: "UN1760", psn: null, hazardClass: "8", pg: "II" }),
];

describe("hmtVerdict", () => {
  it("refuses all five product codes Haiku 5.5 read as UN numbers on 0135071", () => {
    for (const l of PRODUCT_CODE_LINES) expect(hmtVerdict(l)).toMatchObject({ consistent: false });
  });

  it("finds every correctly read office line consistent, naming the table row", () => {
    for (const l of CORRECT_LINES) expect(hmtVerdict(l)).toMatchObject({ consistent: true, hmtRef: expect.stringMatching(/#/) });
  });

  it("refuses a real UN number with a class that contradicts it", () => {
    expect(hmtVerdict(line({ idText: "UN1263", psn: "PAINT", hazardClass: "8", pg: "II" }))).toEqual(
      expect.objectContaining({ consistent: false, reason: "class_mismatch" }));
  });
});

describe("hmtEvidence", () => {
  it("records pass A's value and the table's verdict on each judged field — and never Read on one model's word", () => {
    const ev = hmtEvidence([CORRECT_LINES[0]!, PRODUCT_CODE_LINES[0]!], "1");
    expect(ev.map((e) => e.path)).toEqual([...HMT_JUDGED_KEYS.map((k) => `hazmat.lines[0].${k}`), ...HMT_JUDGED_KEYS.map((k) => `hazmat.lines[1].${k}`)]);
    for (const e of ev) expect(fieldEvidenceSchema.parse(e)).toEqual(e);
    expect(ev.every((e) => e.status === "check" && e.ruleVersion === "1")).toBe(true);
    const id1 = ev.find((e) => e.path === "hazmat.lines[1].idText")!;
    expect(id1.sources).toEqual([
      { reader: "passA", page: null, bbox: null, value: "5607540" },
      { reader: "table", page: null, bbox: null, value: expect.objectContaining({ consistent: false }) },
    ]);
  });

  it("is what a finished shipping-document read records, and nothing for a document with no hazmat lines", () => {
    const doc = { ...emptyShippingDocument(), hazmat: { ...emptyShippingDocument().hazmat, lines: [CORRECT_LINES[2]!] } };
    expect(EVIDENCE_FOR.shipping_document(doc, "1")).toHaveLength(HMT_JUDGED_KEYS.length);
    expect(EVIDENCE_FOR.shipping_document(emptyShippingDocument(), "1")).toEqual([]);
  });
});
