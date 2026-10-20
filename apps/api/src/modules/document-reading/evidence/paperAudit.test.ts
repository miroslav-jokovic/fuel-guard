import { describe, expect, it } from "vitest";
import { emptyShippingDocument, printedHazmatLineSchema, type FieldEvidence, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { shippingEvidence } from "./shippingEvidence.js";
import { auditFieldStates, auditForRead } from "./paperAudit.js";

/**
 * The paper audit of a read (§7A N6 part 3, D-DR22). What must hold: a field both readers read alike is one
 * the audit may judge, so a real shipper error is found without a person retyping the paper; a field the
 * readers disagree on, or the OCR contradicts, is one it may not; and the lines are resolved exactly as the
 * table witness resolves them. The evidence comes from `shippingEvidence`, as a real read records it.
 */
const doc = (lines: Partial<PrintedHazmatLine>[], phone: string | null = "800-424-9300") => {
  const d = emptyShippingDocument();
  d.hazmat.lines = lines.map((l) => printedHazmatLineSchema.parse(l));
  d.hazmat.emergencyPhone = phone;
  d.hazmat.shipperCertification = true;
  return d;
};
const PAINT_NO_PG: Partial<PrintedHazmatLine> = { idText: "UN1263", psn: "Paint", hazardClass: "3", pg: null, descriptionText: "UN1263, Paint, 3", grossWeightLb: 3806, packageCount: 6, packaging: "6 DRUMS" };
const outcome = (a: ReturnType<typeof auditForRead>, ruleId: string) => a?.results.find((r) => r.ruleId === ruleId);

describe("auditForRead", () => {
  it("finds a missing packing group that both readers agree is missing", () => {
    const a = doc([PAINT_NO_PG]);
    const audit = auditForRead(a, shippingEvidence(a, a, "4", null));
    expect(outcome(audit, "paper_class_pg_match")).toMatchObject({ outcome: "fail", lineIndex: 0 });
    expect(outcome(audit, "paper_psn_matches_hmt")).toMatchObject({ outcome: "pass" });
  });

  it("will not judge a field the readers disagree on", () => {
    const a = doc([PAINT_NO_PG]);
    const b = doc([{ ...PAINT_NO_PG, pg: "II" }]);
    const r = outcome(auditForRead(a, shippingEvidence(a, b, "4", null)), "paper_class_pg_match");
    expect(r).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
    expect(r?.facts.unconfirmed).toContain("hazmat.lines[0].pg");
  });

  it("will not judge a field only one reader read", () => {
    const a = doc([PAINT_NO_PG]);
    expect(outcome(auditForRead(a, shippingEvidence(a, null, "4", null)), "paper_class_pg_match")).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
  });

  it("resolves a combustible diesel line as the table witness does, so the shipping name passes", () => {
    const a = doc([{ idText: "NA1993", psn: "Diesel fuel", hazardClass: "Combustible liquid", pg: "III", quantity: { value: 8500, unit: "gal" }, packageCount: 1, packaging: "1 cargo tank" }]);
    expect(outcome(auditForRead(a, shippingEvidence(a, a, "4", null)), "paper_psn_matches_hmt")).toMatchObject({ outcome: "pass" });
  });

  it("says a weight-only line prints only a weight, rather than no quantity", () => {
    const a = doc([PAINT_NO_PG]);
    expect(outcome(auditForRead(a, shippingEvidence(a, a, "4", null)), "paper_quantity_present")).toMatchObject({ outcome: "cannot_tell", reason: "weight_only" });
  });

  it("leaves out a pre-printed line with nothing filled in, and keeps the read's own line numbers", () => {
    const template = { idText: "UN1993", psn: "Flammable liquid, n.o.s.", hazardClass: "3", pg: "III" as const };
    const a = doc([template, PAINT_NO_PG]);
    const b = doc([template, { ...PAINT_NO_PG, pg: "II" }]);
    const audit = auditForRead(a, shippingEvidence(a, b, "4", null))!;
    expect(audit.results.some((r) => r.lineIndex === 0)).toBe(false);
    const pg = audit.results.find((r) => r.ruleId === "paper_class_pg_match");
    expect(pg).toMatchObject({ lineIndex: 1, outcome: "cannot_tell", reason: "field_unconfirmed" });
    expect(pg?.facts.unconfirmed).toEqual(["hazmat.lines[1].pg"]);
  });

  it("names a missing page when the readers write one page marker two ways — a retake of page 1 of 2 (0135071)", () => {
    const pages = (markers: string[]) => { const d = doc([PAINT_NO_PG]); d.identity.printedPageNumbers = markers; return d; };
    const a = pages(["1/2", "1/2"]);
    const b = pages(["Page 1/2", "Page 1/2"]);
    expect(outcome(auditForRead(a, shippingEvidence(a, b, "5", null)), "paper_page_complete"))
      .toMatchObject({ outcome: "fail", reason: "pages_missing", facts: { of: 2, missingPages: [2] } });
    // A marker read as a different page or total is still a disagreement the audit will not judge.
    const c = pages(["1/2", "2/2"]);
    expect(outcome(auditForRead(a, shippingEvidence(a, c, "5", null)), "paper_page_complete"))
      .toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
    const d = pages(["1", "1"]);
    expect(outcome(auditForRead(a, shippingEvidence(a, d, "5", null)), "paper_page_complete"))
      .toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
  });

  it("asks whether non-hazmat lines are printed, not how the readers worded them (profile 1.3.0 rows)", () => {
    const PAINT = { ...PAINT_NO_PG, pg: "II" as const };
    const a = { ...doc([PAINT]), otherLines: [{ description: "Not Regulated", packageCount: 178, grossWeightLb: 3659 }] };
    const b = { ...doc([PAINT]), otherLines: [{ description: "NOT REGULATED SAP 5348472", packageCount: 178, grossWeightLb: 3659 }] };
    const mixed = (x: ShippingDocument, y: ShippingDocument | null) => outcome(auditForRead(x, shippingEvidence(x, y, "7")), "paper_hm_column")?.reason;
    expect(outcome(auditForRead(a, shippingEvidence(a, b, "7")), "paper_hm_column")?.facts).toMatchObject({ mixedPaper: true });
    expect(mixed(doc([PAINT]), doc([PAINT]))).toBe("not_mixed");
    // one reader read a non-hazmat row and the other none: the audit cannot tell
    expect(outcome(auditForRead(a, shippingEvidence(a, doc([PAINT]), "7")), "paper_hm_column")?.facts).toMatchObject({ mixedPaper: null });
    // a 1.2.0 read stored the rows as strings: they parse, and still count
    const legacy = { ...doc([PAINT]), otherLines: ["Not Regulated"] };
    expect(auditForRead(legacy, [{ path: "otherLines", value: ["Not Regulated"], status: "check", ruleVersion: "6",
      sources: [{ reader: "passA", page: null, bbox: null, value: ["Not Regulated"] }, { reader: "passB", page: null, bbox: null, value: ["Not regulated"] }] }])).not.toBeNull();
  });

  describe("a cell the readers read to different extents (R-M2, production read 350d2f27)", () => {
    const CAUSTIC = { idText: "UN1824", psn: "SODIUM HYDROXIDE, SOLUTION", hazardClass: "8", pg: "II" as const, packageCount: 8, grossWeightLb: 29800 };
    const long = doc([{ ...CAUSTIC, descriptionText: "UN1824, SODIUM HYDROXIDE, SOLUTION 8, PGII, CAUSTIC SODA 50% 3600# TOTE", packaging: "8 3600LBTOTE FG00035-3600T" }]);
    const short = doc([{ ...CAUSTIC, descriptionText: "UN1824, SODIUM HYDROXIDE, SOLUTION 8, PGII", packaging: "8 3600LBTOTE" }]);
    const RULES = ["paper_sequence", "paper_technical_name", "paper_lq", "paper_marine_pollutant", "paper_package_count"];

    it("judges a description and a packaging cell one reader carried further, whichever reader that was", () => {
      for (const [a, b] of [[long, short], [short, long]] as const) {
        const audit = auditForRead(a, shippingEvidence(a, b, "10", null));
        for (const id of RULES) expect(outcome(audit, id)?.reason, id).not.toBe("field_unconfirmed");
        expect(outcome(audit, "paper_sequence")).toMatchObject({ outcome: "pass" });
      }
    });

    it("will not judge a description one reader read one regulated word further", () => {
      const lq = doc([{ ...CAUSTIC, descriptionText: "UN1824, SODIUM HYDROXIDE, SOLUTION 8, PGII, LTD QTY", packaging: "8 3600LBTOTE" }]);
      const r = outcome(auditForRead(lq, shippingEvidence(lq, short, "10", null)), "paper_lq");
      expect(r).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
      expect(r?.facts.unconfirmed).toContain("hazmat.lines[0].descriptionText");
    });

    it("refuses the one rule whose answer moves with a tail the token list cannot foresee — an EPA waste code", () => {
      // NA3082 is a G entry: without a technical name it does not pass, unless a waste code stands for it (§172.203(k)(2)(i)).
      const WASTE = { idText: "NA3082", psn: "Hazardous waste, liquid, n.o.s.", hazardClass: "9", pg: "III" as const, packageCount: 4, grossWeightLb: 2000, packaging: "4 DRUMS" };
      const coded = doc([{ ...WASTE, descriptionText: "NA3082, Hazardous waste, liquid, n.o.s., 9, PGIII, D001" }]);
      const bare = doc([{ ...WASTE, descriptionText: "NA3082, Hazardous waste, liquid, n.o.s., 9, PGIII" }]);
      expect(outcome(auditForRead(coded, shippingEvidence(coded, coded, "10", null)), "paper_technical_name")).toMatchObject({ outcome: "pass" });
      expect(outcome(auditForRead(bare, shippingEvidence(bare, bare, "10", null)), "paper_technical_name")?.outcome).not.toBe("pass");
      for (const [a, b] of [[coded, bare], [bare, coded]] as const) {
        const audit = auditForRead(a, shippingEvidence(a, b, "10", null));
        expect(outcome(audit, "paper_technical_name")).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed", facts: { unconfirmed: ["hazmat.lines[0].descriptionText"] } });
        expect(outcome(audit, "paper_sequence")).toMatchObject({ outcome: "pass" });
      }
    });
  });

  it("answers nothing for a result that is not a shipping document", () => {
    expect(auditForRead({ hazmat: { lines: "nope" } }, [])).toBeNull();
  });
});

describe("auditFieldStates", () => {
  const e = (sources: FieldEvidence["sources"], value: unknown = 6, status: FieldEvidence["status"] = "check"): FieldEvidence =>
    ({ path: "hazmat.lines[0].packageCount", value: value as never, status, sources, ruleVersion: "4" });
  const A = (v: unknown) => ({ reader: "passA" as const, page: null, bbox: null, value: v as never });
  const B = (v: unknown) => ({ reader: "passB" as const, page: null, bbox: null, value: v as never });
  const O = (v: unknown) => ({ reader: "ocr" as const, page: 1, bbox: null, value: v as never });
  const state = (x: FieldEvidence) => auditFieldStates([x])["hazmat.lines[0].packageCount"];

  it("counts a field as confirmed when both readers agree and the OCR, if it judged, found the same", () => {
    expect(state(e([A(6), B(6)]))).toBe("read");
    expect(state(e([A(6), B(6), O(6)]))).toBe("read");
    expect(state(e([A(null), B(null)], null, "not_read"))).toBe("read");
  });

  it("keeps the evidence's own state where the readers disagree, one is missing, or the OCR did not find the value", () => {
    expect(state(e([A(6), B(9)]))).toBe("check");
    expect(state(e([A(6)]))).toBe("check");
    expect(state(e([A(6), B(6), O(null)]))).toBe("check");
    expect(state(e([A(6), B(9)], 6, "read"))).toBe("read");
  });

  it("holds a born-digital page's text layer to the same bar as the OCR (§7B A4)", () => {
    const T = (v: unknown) => ({ reader: "textLayer" as const, page: 1, bbox: null, value: v as never });
    expect(state(e([A(6), B(6), T(6)]))).toBe("read");
    expect(state(e([A(6), B(6), T(null)]))).toBe("check");
    // Two row witnesses must both back it: the OCR finding 6 does not outvote the text layer finding none.
    expect(state(e([A(6), B(6), O(6), T(null)]))).toBe("check");
  });

  it("does not confirm a value the paper's totals fit no reading of (Q-DR26 L3), and confirms one they back", () => {
    const S = (v: unknown) => ({ reader: "arithmetic" as const, page: null, bbox: null, value: v as never });
    expect(state(e([A(6), B(6), O(6), S(null)]))).toBe("check");
    expect(state(e([A(6), B(6), S(6)]))).toBe("read");
  });
});
