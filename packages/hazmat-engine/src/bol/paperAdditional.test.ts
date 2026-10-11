import { describe, expect, it } from "vitest";
import { DS, DS_PRE_8A, GASOLINE, failed, ok, pline, result, rline } from "./paperAudit.fixtures.js";

/**
 * The §172.203 additional-entry rules of `auditPrintedPaper`: RQ, Limited Quantity, Marine Pollutant.
 * Each reads its requirement from the dataset (Appendix A, column 8A, Appendix B / SP 441).
 */

const benzene = (over = {}) => pline({ idText: "UN1114", psn: "Benzene", pg: "II", quantity: { value: 55, unit: "lb" }, packageCount: 1, packaging: "1 drum", ...over });
const benzeneRes = (over = {}) => rline(ok("UN1114-benzene", "II"), { quantityUnit: "lb", packagingKind: "non_bulk", ...over });

describe("paper_rq — \"RQ\" when a package holds the reportable quantity (§172.203(c))", () => {
  it("passes a benzene drum that prints RQ", () => {
    const r = result({ lines: [[benzene({ psn: "RQ, Benzene" }), benzeneRes()]] }, "paper_rq");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("printed");
  });
  it("accepts RQ entered in the HM column", () => {
    expect(result({ lines: [[benzene({ hmColumnMark: "RQ" }), benzeneRes()]] }, "paper_rq").reason).toBe("printed");
  });
  it("fails 55 lb of benzene in one drum with no RQ — Appendix A puts it at 10 lb", () => {
    const r = result({ lines: [[benzene(), benzeneRes()]] }, "paper_rq");
    expect(r.outcome).toBe("fail");
    expect(r.facts.substance).toBe("Benzene");
    expect(r.facts.rq).toBe(10);
    expect(r.facts.perPackage).toBe(55);
    expect(r.facts.unit).toBe("lb");
  });
  it("fails a package holding exactly the RQ — \"meets\" is at or over", () => {
    expect(result({ lines: [[benzene({ quantity: { value: 10, unit: "lb" } }), benzeneRes()]] }, "paper_rq").outcome).toBe("fail");
  });
  it("compares kilograms against Appendix A's kilogram column, never converting", () => {
    const r = result({ lines: [[benzene({ quantity: { value: 4, unit: "kg" } }), benzeneRes({ quantityUnit: "kg" })]] }, "paper_rq");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("below_rq");
    expect(r.facts.rq).toBe(4.54);
  });
  it("passes gasoline: Appendix A does not list it", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_rq").reason).toBe("not_listed");
  });
  it("cannot tell a benzene quantity printed in gallons — Appendix A is by mass", () => {
    const r = result({ lines: [[benzene({ quantity: { value: 55, unit: "gal" } }), benzeneRes({ quantityUnit: "gal" })]] }, "paper_rq");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("quantity_not_by_mass");
  });
  it("cannot tell a mixture whose technical name is listed when the package exceeds the component's RQ", () => {
    const fl = pline({ idText: "UN1993", psn: "Flammable liquids, n.o.s.", technicalName: "Benzene", pg: "II", quantity: { value: 400, unit: "lb" } });
    const r = result({ lines: [[fl, rline(ok("UN1993-flammable-liquids-n-o-s", "II"), { quantityUnit: "lb" })]] }, "paper_rq");
    expect(r.reason).toBe("concentration_unknown");
  });
  it("cannot tell a G entry that prints no technical name to look up", () => {
    const fl = pline({ idText: "UN1993", psn: "Flammable liquids, n.o.s.", pg: "II" });
    expect(result({ lines: [[fl, rline(ok("UN1993-flammable-liquids-n-o-s", "II"))]] }, "paper_rq").reason).toBe("technical_name_not_printed");
  });
  it("cannot tell when the dataset carries no Appendix A", () => {
    const r = result({ lines: [[benzene(), benzeneRes()]], resolved: { dataset: { ...DS, hazSubstances: [] } } }, "paper_rq");
    expect(r.reason).toBe("requirement_not_in_dataset");
  });
  it("cannot tell on an unresolved line", () => {
    expect(result({ lines: [[benzene(), rline(failed("id_not_found"))]] }, "paper_rq").reason).toBe("line_unresolved");
  });
});

describe("paper_lq — Limited Quantity words, and the HMT authorises them (§172.203(b))", () => {
  it("passes LTD QTY on gasoline: column 8A names §173.150", () => {
    const r = result({ lines: [[pline({ marks: ["LTD QTY"], packaging: "4 cases" }), rline(ok("UN1203-gasoline", "II"), { packagingKind: "non_bulk" })]] }, "paper_lq");
    expect(r.outcome).toBe("pass");
    expect(r.facts.exceptionsRef).toBe("150");
  });
  it("passes a line that neither prints nor claims LQ", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_lq").reason).toBe("not_claimed");
  });
  it("fails a Limited Quantity claimed on the order but absent from the paper", () => {
    const r = result({ lines: [[pline(), rline(ok("UN1203-gasoline", "II"), { claimedLimitedQuantity: true })]] }, "paper_lq");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("claimed_not_printed");
  });
  it("fails LQ printed for a material whose column 8A is None", () => {
    const acn = pline({ idText: "UN1541", psn: "Acetone cyanohydrin, stabilized", hazardClass: "6.1", pg: "I", marks: ["LIMITED QUANTITY"] });
    const r = result({ lines: [[acn, rline(ok("UN1541-acetone-cyanohydrin-stabilized", "I"))]] }, "paper_lq");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("not_authorised");
  });
  it("cannot tell on a dataset cut before column 8A", () => {
    const r = result({ lines: [[pline({ marks: ["LTD QTY"] }), rline(ok("UN1203-gasoline", "II"))]], resolved: { dataset: DS_PRE_8A } }, "paper_lq");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("requirement_not_in_dataset");
  });
  it("cannot tell when the marks are Check", () => {
    expect(result({ lines: [GASOLINE()], fieldStates: { "hazmat.lines[0].marks": "check" } }, "paper_lq").reason).toBe("field_unconfirmed");
  });
});

describe("paper_marine_pollutant — the words when they apply (§172.203(l))", () => {
  const acn = (over = {}) => pline({ idText: "UN1541", psn: "Acetone cyanohydrin, stabilized", hazardClass: "6.1", pg: "I", ...over });
  const acnRes = (over = {}) => rline(ok("UN1541-acetone-cyanohydrin-stabilized", "I"), over);

  it("passes an Appendix B material in bulk that prints MARINE POLLUTANT", () => {
    expect(result({ lines: [[acn({ marks: ["MARINE POLLUTANT"] }), acnRes()]] }, "paper_marine_pollutant").reason).toBe("printed");
  });
  it("passes gasoline: not on Appendix B", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_marine_pollutant").reason).toBe("not_listed");
  });
  it("passes a non-bulk Appendix B material on an all-highway move (§171.4(c)(1))", () => {
    const r = result({ lines: [[acn(), acnRes({ packagingKind: "non_bulk" })]], resolved: { vesselLeg: false } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("not_required_non_bulk_highway");
  });
  it("fails an Appendix B material in bulk with no marine-pollutant words", () => {
    const r = result({ lines: [[acn(), acnRes()]] }, "paper_marine_pollutant");
    expect(r.outcome).toBe("fail");
    expect(r.facts.requiredPsn).toBe("Acetone cyanohydrin, stabilized");
  });
  it("fails a non-bulk Appendix B material when any leg is by vessel", () => {
    const r = result({ lines: [[acn(), acnRes({ packagingKind: "non_bulk" })]], resolved: { vesselLeg: true } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("fail");
    expect(r.facts.vesselLeg).toBe(true);
  });
  it("fails UN3082 in bulk without the words, by the SP 441 identity route", () => {
    const ehs = pline({ idText: "UN3082", psn: "Environmentally hazardous substance, liquid, n.o.s.", technicalName: "copper sulfate", hazardClass: "9", pg: "III" });
    expect(result({ lines: [[ehs, rline(ok("UN3082-environmentally-hazardous-substance-liquid-n-o-s", "III"))]] }, "paper_marine_pollutant").outcome).toBe("fail");
  });
  it("cannot tell a non-bulk Appendix B material when nobody said whether a vessel leg exists", () => {
    const r = result({ lines: [[acn(), acnRes({ packagingKind: "non_bulk" })]] }, "paper_marine_pollutant");
    expect(r.reason).toBe("applicability_unknown");
  });
  it("cannot tell when the dataset carries no Appendix B", () => {
    const r = result({ lines: [[acn(), acnRes()]], resolved: { dataset: { ...DS, marinePollutants: [] } } }, "paper_marine_pollutant");
    expect(r.reason).toBe("requirement_not_in_dataset");
  });
});
