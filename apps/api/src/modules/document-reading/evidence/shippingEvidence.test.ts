import { describe, expect, it } from "vitest";
import { emptyShippingDocument, fieldEvidenceSchema, printedHazmatLineSchema, readersAgree, valuesAgree, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { alignLines } from "./alignLines.js";
import { HMT_JUDGED_KEYS } from "./hmtWitness.js";
import { EVIDENCE_FOR } from "./index.js";
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
    const a = doc([line({ ...UN2735 })]);
    expect(EVIDENCE_FOR.shipping_document(a, a, "2")).toEqual(shippingEvidence(a, a, "2"));
  });
});
