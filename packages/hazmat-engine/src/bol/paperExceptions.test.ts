import { describe, expect, it } from "vitest";
import { DS, GASOLINE, ok, pline, result, rline } from "./paperAudit.fixtures.js";

/**
 * The exceptions the printed-paper rules first shipped without, each against the eCFR text of 2026-10-09:
 * §172.202(a)(5)(iii) and (a)(7) for quantity and packages, §172.203(k)(1)–(2) for technical names,
 * §172.203(l)(3) and §171.4(c)(2) for marine pollutants.
 */

describe("paper_quantity_present — §172.202(a)(5)(iii) \"excepted from the requirements of paragraph (a)(5)\"", () => {
  const counted = (packaging: string, over = {}) =>
    result({ lines: [[pline({ quantity: { value: null, unit: null }, packaging, packageCount: 2 }), rline(ok("UN1203-gasoline", "II"), over)]] }, "paper_quantity_present");

  it("(A) \"Bulk packages, provided some indication of the total quantity is shown, for example, \"1 cargo tank\" or \"2 IBCs.\"\"", () => {
    expect(counted("2 IBCs", { packagingKind: "non_bulk" }).reason).toBe("bulk_package_count");
    expect(counted("2 portable tanks", { packagingKind: null }).reason).toBe("bulk_package_count");
  });
  it("(A) reads the caller's bulk derivation too, whatever the packaging is called", () => {
    expect(counted("2 totes", { packagingKind: "bulk" }).reason).toBe("bulk_package_count");
  });
  it("(B) \"Cylinders, provided some indication of the total quantity is shown, for example, \"10 cylinders.\"\"", () => {
    const lpg = pline({ idText: "UN1075", psn: "Petroleum gases, liquefied", hazardClass: "2.1", pg: null, quantity: { value: null, unit: null }, packaging: "10 cyl.", packageCount: 10 });
    const r = result({ lines: [[lpg, rline(ok("UN1075-petroleum-gases-liquefied", null), { packagingKind: "non_bulk" })]] }, "paper_quantity_present");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("cylinder_count");
  });
  it("still fails non-bulk drums with no quantity — neither exception reaches them", () => {
    expect(counted("2 drums", { packagingKind: "non_bulk" }).reason).toBe("missing");
  });
});

describe("paper_package_count — §172.202(a)(7) \"The number and type of packages must be indicated\"", () => {
  it("passes \"1 cargo tank\"", () => {
    const r = result({ lines: [GASOLINE()] }, "paper_package_count");
    expect(r.outcome).toBe("pass");
    expect(r.facts.packageCount).toBe(1);
  });
  it("passes a count read from the packaging phrase (\"12 drums\") when the count field is empty", () => {
    expect(result({ lines: [[pline({ packageCount: null, packaging: "12 drums" }), rline(null)]] }, "paper_package_count").outcome).toBe("pass");
  });
  it("fails a type with no number", () => {
    const r = result({ lines: [[pline({ packageCount: null, packaging: "drums" }), rline(null)]] }, "paper_package_count");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("count_missing");
  });
  it("fails a number with no type", () => {
    expect(result({ lines: [[pline({ packageCount: 4, packaging: null }), rline(null)]] }, "paper_package_count").reason).toBe("type_missing");
  });
  it("cannot tell when the packaging is Not read", () => {
    expect(result({ lines: [GASOLINE()], fieldStates: { "hazmat.lines[0].packaging": "not_read" } }, "paper_package_count").outcome).toBe("cannot_tell");
  });
});

describe("paper_technical_name — §172.203(k)(1)–(2)", () => {
  const fl = (over = {}) => pline({ idText: "UN1993", psn: "Flammable liquids, n.o.s.", pg: "II", ...over });
  const flRes = (over = {}) => rline(ok("UN1993-flammable-liquids-n-o-s", "II"), over);

  it("(k)(1) \"the technical names of at least two components\" — one name on a mixture of two hazardous materials fails", () => {
    const r = result({ lines: [[fl({ technicalName: "toluene" }), flRes({ hazardousComponents: 2 })]] }, "paper_technical_name");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("needs_two_components");
  });
  it("(k)(1) two names on a mixture pass", () => {
    expect(result({ lines: [[fl({ technicalName: "toluene, xylene" }), flRes({ hazardousComponents: 2 })]] }, "paper_technical_name").reason).toBe("printed");
  });
  it("(k)(1) one name when nobody knows whether it is a mixture of two or more hazardous materials cannot tell", () => {
    const r = result({ lines: [[fl({ technicalName: "toluene" }), flRes()]] }, "paper_technical_name");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("mixture_unknown");
  });
  it("(k)(1) one name on a single hazardous component passes", () => {
    expect(result({ lines: [[fl({ technicalName: "toluene" }), flRes({ hazardousComponents: 1 })]] }, "paper_technical_name").reason).toBe("printed");
  });
  it("(k)(2)(i) \"Hazardous waste, liquid or solid, n.o.s.\", Class 9, \"provided the EPA hazardous waste number is included\"", () => {
    const hw = pline({ idText: "NA3082", psn: "Hazardous waste, liquid, n.o.s.", hazardClass: "9", pg: "III", marks: ["D001"] });
    const r = result({ lines: [[hw, rline(ok("NA3082-hazardous-waste-liquid-n-o-s", "III"))]] }, "paper_technical_name");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("excepted_k2i_waste_code");
  });
  it("(k)(2)(i) without the waste number the exception is not met", () => {
    const hw = pline({ idText: "NA3082", psn: "Hazardous waste, liquid, n.o.s.", hazardClass: "9", pg: "III" });
    expect(result({ lines: [[hw, rline(ok("NA3082-hazardous-waste-liquid-n-o-s", "III"))]] }, "paper_technical_name").outcome).toBe("fail");
  });
  it("(k)(2)(ii) \"a material for which the hazard class is to be determined by testing under … §172.101(c)(11)\" — a printed \"Sample\"", () => {
    expect(result({ lines: [[fl({ marks: ["SAMPLE"] }), flRes()]] }, "paper_technical_name").reason).toBe("excepted_k2ii_sample");
  });
  it("(k)(2)(iii)/(iv) \"contains the name of the chemical element or group\" — a group-named n.o.s. entry with no technical name cannot tell", () => {
    const am = pline({ idText: "UN2734", psn: "Amine, liquid, corrosive, flammable, n.o.s.", hazardClass: "8", pg: "II" });
    const r = result({ lines: [[am, rline(ok("UN2734-amine-liquid-corrosive-flammable-n-o-s", "II"))]] }, "paper_technical_name");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("k2_group_named");
  });
  it("still fails a hazard-named n.o.s. entry (\"Flammable liquids, n.o.s.\") with no technical name — it names no chemical group", () => {
    expect(result({ lines: [[fl(), flRes()]] }, "paper_technical_name").outcome).toBe("fail");
  });
});

describe("paper_marine_pollutant — §172.203(l)(3) and §171.4(c)(2)", () => {
  const acn = (over = {}) => pline({ idText: "UN1541", psn: "Acetone cyanohydrin, stabilized", hazardClass: "6.1", pg: "I", ...over });
  const acnRes = (over = {}) => rline(ok("UN1541-acetone-cyanohydrin-stabilized", "I"), over);
  const diesel = (over = {}) => pline({ idText: "NA1993", psn: "Diesel fuel", hazardClass: "3", pg: "III", ...over });
  const dsMp = { ...DS, marinePollutants: [...DS.marinePollutants, { name: "Diesel fuel", nameNormalized: "diesel fuel", severe: false }] };

  it("(l)(3) \"Except for transportation by vessel, marine pollutants subject to … 49 CFR 130.11 are excepted … if a phrase indicating the material is an oil is placed in association with the basic description\"", () => {
    const r = result({ lines: [[diesel(), rline(ok("NA1993-diesel-fuel", "III"), { subjectToPart130: true })]], resolved: { dataset: dsMp, vesselLeg: false } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("excepted_oil_130_11");
  });
  it("(l)(3) does not reach a vessel leg", () => {
    const r = result({ lines: [[diesel(), rline(ok("NA1993-diesel-fuel", "III"), { subjectToPart130: true })]], resolved: { dataset: dsMp, vesselLeg: true } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("fail");
  });
  it("(l)(3) cannot tell when nobody said the material is subject to Part 130", () => {
    const r = result({ lines: [[diesel(), rline(ok("NA1993-diesel-fuel", "III"))]], resolved: { dataset: dsMp, vesselLeg: false } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("oil_exception_may_apply");
  });
  it("§171.4(c)(2) \"a net quantity per single or inner packaging of 5 L or less for liquids\" is excepted, even with a vessel leg", () => {
    const small = acn({ quantity: { value: 16, unit: "L" }, packageCount: 4, packaging: "4 cans" });
    const r = result({ lines: [[small, acnRes({ quantityUnit: "L", packagingKind: "non_bulk", physicalState: "liquid" })]], resolved: { vesselLeg: true } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("excepted_small_package_171_4_c2");
  });
  it("§171.4(c)(2) \"This exception does not apply to marine pollutants that are a hazardous waste or a hazardous substance\" — RQ printed", () => {
    const small = acn({ quantity: { value: 4, unit: "L" }, packageCount: 4, packaging: "4 cans", marks: ["RQ"] });
    const r = result({ lines: [[small, acnRes({ quantityUnit: "L", packagingKind: "non_bulk" })]], resolved: { vesselLeg: true } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("fail");
  });
  it("§171.4(c)(2) cannot tell when the quantity per package is unknown", () => {
    const r = result({ lines: [[acn({ quantity: { value: null, unit: null }, packageCount: 4, packaging: "4 cans" }), acnRes({ quantityUnit: null, packagingKind: "non_bulk" })]], resolved: { vesselLeg: true } }, "paper_marine_pollutant");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("package_quantity_unknown");
  });
});
