import { describe, expect, it } from "vitest";
import { GASOLINE, ok, pline, result, rline } from "./paperAudit.fixtures.js";

/**
 * The rules that read a line's printed description as one string (`descriptionText`, which the reader's
 * contract will carry — Q-DR13): the §172.202(b) sequence, §172.203(b)'s "following the basic
 * description", and §172.201(a)(1)(i)'s "entered first". Quotes are eCFR's text of 2026-10-09.
 */

const gas = (descriptionText: string) => [pline({ descriptionText }), rline(ok("UN1203-gasoline", "II"))] as ReturnType<typeof GASOLINE>;
const seq = (descriptionText: string) => result({ lines: [gas(descriptionText)] }, "paper_sequence");

describe("paper_sequence — §172.202(b): \"must be shown in sequence with no additional information interspersed\"", () => {
  it("verifies the order of \"UN1203, Gasoline, 3, II\"", () => {
    const r = seq("UN1203, Gasoline, 3, II");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("in_sequence");
    expect(r.facts.orderVerified).toBe(true);
  });
  it("fails a class printed before the shipping name", () => {
    const r = seq("UN1203, 3, Gasoline, II");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("out_of_order");
  });
  it("fails a product code interspersed between the shipping name and the class", () => {
    const r = seq("UN1203, Gasoline, SKU 4471, 3, II");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("interspersed");
    expect(r.facts.interspersed).toBe("SKU 4471");
  });
  it("(a)(3)(i) \"The words \"Class\" or \"Division\" may be included preceding the primary … numbers\"", () => {
    expect(seq("UN1203, Gasoline, Class 3, II").reason).toBe("in_sequence");
  });
  it("(a)(3)(iii) \"hazard class or division names may be entered following the numerical hazard class\"", () => {
    expect(seq("UN1203, Gasoline, 3 Flammable liquid, II").reason).toBe("in_sequence");
  });
  it("(a)(4) \"The packing group may be preceded by the letters \"PG\"\"", () => {
    expect(seq("UN1203, Gasoline, 3, PG II").reason).toBe("in_sequence");
  });
  it("(d) \"Technical and chemical group names may be entered in parentheses between the proper shipping name and hazard class\"", () => {
    const fl = pline({ idText: "UN1993", psn: "Flammable liquids, n.o.s.", technicalName: "toluene", descriptionText: "UN1993, Flammable liquids, n.o.s. (contains Toluene), 3, II" });
    expect(result({ lines: [[fl, rline(ok("UN1993-flammable-liquids-n-o-s", "II"))]] }, "paper_sequence").reason).toBe("in_sequence");
  });
  it("§172.203(c)(2) \"RQ\" \"either before or after the basic description\" — and quantity before it (§172.202(c)(1))", () => {
    expect(seq("RQ, 1 cargo tank, 8000 gal, UN1203, Gasoline, 3, II").reason).toBe("in_sequence");
    expect(seq("UN1203, Gasoline, 3, II, RQ").reason).toBe("in_sequence");
  });
  it("§172.203(n) \"the word \"HOT\" must immediately precede the proper shipping name\"", () => {
    expect(seq("UN1203, HOT Gasoline, 3, II").reason).toBe("in_sequence");
  });
  it("cannot tell when the transcribed fields are not found in the description text", () => {
    const r = seq("UN 1203 Motor spirit 3 II");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("description_text_unmatched");
  });
  it("keeps orderVerified false without description text", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_sequence").facts.orderVerified).toBe(false);
  });
});

describe("paper_lq — §172.203(b): the words \"Limited Quantity\" or \"Ltd Qty\" \"following the basic description\"", () => {
  const lq = (descriptionText?: string) =>
    result({ lines: [[pline({ marks: ["LTD QTY"], packaging: "4 cases", ...(descriptionText ? { descriptionText } : {}) }), rline(ok("UN1203-gasoline", "II"), { packagingKind: "non_bulk" })]] }, "paper_lq");

  it("passes the words after the description, and says the position was checked", () => {
    const r = lq("UN1203, Gasoline, 3, II, Ltd Qty");
    expect(r.outcome).toBe("pass");
    expect(r.facts.positionVerified).toBe(true);
  });
  it("fails the words printed before the description", () => {
    const r = lq("Ltd Qty UN1203, Gasoline, 3, II");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("lq_not_following");
  });
  it("cannot tell when the words are in the marks but not in the description text", () => {
    expect(lq("UN1203, Gasoline, 3, II").reason).toBe("lq_outside_description");
  });
  it("accepts the words from the marks alone without description text, saying the position was not checked", () => {
    const r = lq();
    expect(r.outcome).toBe("pass");
    expect(r.facts.positionVerified).toBe(false);
  });
});

describe("paper_hm_column — §172.201(a)(1)(i) \"Must be entered first\"", () => {
  it("passes an unmarked line on a mixed paper whose hazmat entries are listed first", () => {
    const r = result({ lines: [GASOLINE()], resolved: { mixedPaper: true, hazmatEntriesFirst: true } }, "paper_hm_column");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("listed_first");
  });
  it("still cannot tell when hazmat is not listed first — (a)(1)(ii)'s contrasting colour is not read", () => {
    const r = result({ lines: [GASOLINE()], resolved: { mixedPaper: true, hazmatEntriesFirst: false } }, "paper_hm_column");
    expect(r.outcome).toBe("cannot_tell");
  });
  it("(a)(1)(iii) \"in a column captioned \"HM\"\" — a mark passes but says the caption was not read", () => {
    const r = result({ lines: [[pline({ hmColumnMark: "X" }), rline(null)]] }, "paper_hm_column");
    expect(r.reason).toBe("marked");
    expect(r.facts.columnCaptionVerified).toBe(false);
  });
});
