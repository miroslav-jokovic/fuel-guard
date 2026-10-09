import { describe, expect, it } from "vitest";
import { BOL_FINDING_ACTORS, BOL_FINDING_CATALOGUE, BOL_FINDING_RULE_IDS, type BolFindingContext, type BolFindingRuleId } from "./bolFindingCatalogue.js";

/**
 * Every catalogue entry rendered with a real context — the facts `auditPrintedPaper` returns for that
 * rule and reason (copied from the engine's own tests; the API parity test renders the engine's live
 * output through the same entries). A sentence must name the line and the values, never leak a blank.
 */

const ctx = (outcome: BolFindingContext["outcome"], reason: string, facts: BolFindingContext["facts"] = {}, lineIndex: number | null = 0): BolFindingContext => ({ outcome, reason, lineIndex, facts });

const CASES: Array<[BolFindingRuleId, BolFindingContext, string]> = [
  ["paper_sequence", ctx("fail", "elements_missing", { lineLabel: "Line 1", missing: ["id", "psn", "class"] }), "Line 1 on the BOL is missing the UN/NA number, the proper shipping name and the hazard class from its hazmat description."],
  ["paper_sequence", ctx("pass", "all_elements_printed", { lineLabel: "UN1203", printed: "UN1203, Gasoline, 3, II", orderVerified: false }), "UN1203 prints all four parts (UN1203, Gasoline, 3, II); check by eye that they read in that order with nothing between them — the reader does not record it."],
  ["paper_sequence", ctx("pass", "in_sequence", { lineLabel: "UN1203", printed: "UN1203, Gasoline, 3, II", descriptionText: "UN1203, Gasoline, 3, II", orderVerified: true }), "UN1203's description reads in the required order: UN1203, Gasoline, 3, II."],
  ["paper_sequence", ctx("fail", "out_of_order", { lineLabel: "UN1203", printed: "UN1203, Gasoline, 3, II", descriptionText: "UN1203, 3, Gasoline, II" }), "UN1203's description reads \"UN1203, 3, Gasoline, II\" — the number, shipping name, class and packing group must come in that order."],
  ["paper_sequence", ctx("fail", "interspersed", { lineLabel: "UN1203", printed: "UN1203, Gasoline, 3, II", descriptionText: "UN1203, Gasoline, SKU 4471, 3, II", interspersed: "SKU 4471" }), "UN1203's description has \"SKU 4471\" in the middle of it; nothing else may stand between the number, shipping name, class and packing group."],
  ["paper_sequence", ctx("cannot_tell", "description_text_unmatched", { lineLabel: "UN1203", printed: "UN1203, Gasoline, 3, II", descriptionText: "UN 1203 Motor spirit 3 II" }), "Can't check the order of UN1203's description: the parts the reader recorded don't all appear in the printed text \"UN 1203 Motor spirit 3 II\"."],
  ["paper_psn_matches_hmt", ctx("fail", "psn_not_in_hmt", { lineLabel: "UN1203", printedPsn: "Gas", candidatePsns: ["Gasoline"] }), "The BOL calls UN1203 \"Gas\", which is not a proper shipping name for that number (the table lists: Gasoline)."],
  ["paper_psn_matches_hmt", ctx("fail", "psn_missing", { lineLabel: "UN1203", requiredPsn: "Gasoline" }), "The BOL shows UN1203 with no shipping name; the table's name is \"Gasoline\"."],
  ["paper_psn_matches_hmt", ctx("pass", "matched", { lineLabel: "UN1203", printedPsn: "Gasoline", requiredPsn: "Gasoline" }), "UN1203's shipping name matches the table (\"Gasoline\")."],
  ["paper_class_pg_match", ctx("fail", "class_or_pg_wrong", { lineLabel: "UN1203", printedClass: "3", printedPg: null, requiredClass: "3", requiredPg: "II", classProblem: null, pgProblem: "missing" }), "The BOL for UN1203 prints no packing group (the table requires PG II)."],
  ["paper_class_pg_match", ctx("fail", "class_or_pg_wrong", { lineLabel: "UN1075", printedClass: "2.1", printedPg: "II", requiredClass: "2.1", requiredPg: null, classProblem: null, pgProblem: "not_allowed" }), "The BOL for UN1075 prints PG II, but this material has no packing group."],
  ["paper_class_pg_match", ctx("fail", "class_or_pg_wrong", { lineLabel: "UN1993", printedClass: "8", printedPg: null, requiredClass: "3", requiredPg: ["I", "II", "III"], classProblem: "differs", pgProblem: "missing" }), "The BOL for UN1993 prints class 8 where the table says 3 and prints no packing group (the table requires one of PG I, II and III)."],
  ["paper_class_pg_match", ctx("pass", "matches", { lineLabel: "UN1203", requiredClass: "3", requiredPg: "II" }), "UN1203's class 3 and PG II match the table."],
  ["paper_technical_name", ctx("fail", "missing", { lineLabel: "UN1993", requiredPsn: "Flammable liquids, n.o.s." }), "UN1993 is an n.o.s. entry (\"Flammable liquids, n.o.s.\") and the BOL doesn't name what is actually in it."],
  ["paper_technical_name", ctx("pass", "printed", { lineLabel: "UN1993", technicalName: "toluene" }), "UN1993 names its contents (toluene), as an n.o.s. entry must."],
  ["paper_technical_name", ctx("fail", "needs_two_components", { lineLabel: "UN1993", technicalName: "toluene", namedComponents: 1 }), "UN1993 is a mixture of two or more hazardous materials and the BOL names only one (toluene); the two that contribute most to the hazard must be named."],
  ["paper_technical_name", ctx("cannot_tell", "mixture_unknown", { lineLabel: "UN1993", technicalName: "toluene", namedComponents: 1 }), "UN1993 names one component (toluene); if it is a mixture of two or more hazardous materials, two must be named — check the safety data sheet."],
  ["paper_technical_name", ctx("pass", "excepted_k2i_waste_code", { lineLabel: "NA3082" }), "NA3082 is hazardous waste with its EPA waste number printed, which takes the place of a technical name."],
  ["paper_technical_name", ctx("pass", "excepted_k2i_hazardous_substance_named", { lineLabel: "NA3082", technicalName: "benzene" }), "NA3082 is hazardous waste and names its hazardous substance (benzene)."],
  ["paper_technical_name", ctx("pass", "excepted_k2ii_sample", { lineLabel: "UN1993" }), "UN1993 is a sample whose class is still to be determined by testing, so no technical name is required."],
  ["paper_technical_name", ctx("cannot_tell", "k2_group_named", { lineLabel: "UN2734", requiredPsn: "Amine, liquid, corrosive, flammable, n.o.s." }), "UN2734's shipping name (\"Amine, liquid, corrosive, flammable, n.o.s.\") already names a chemical group; whether it still needs a technical name depends on what makes it hazardous — check the safety data sheet."],
  ["paper_technical_name", ctx("cannot_tell", "requirement_not_in_dataset", { lineLabel: "UN1993", needs: "HMT column 1 symbols" }), "Can't check the technical name on UN1993: the regulatory data this check needs (HMT column 1 symbols) isn't in the loaded dataset version."],
  ["paper_rq", ctx("fail", "rq_not_printed", { lineLabel: "UN1114", substance: "Benzene", rq: 10, perPackage: 55, unit: "lb" }), "UN1114 has 55 lb per package of Benzene, at or over its reportable quantity of 10 lb, but the BOL doesn't say \"RQ\"."],
  ["paper_rq", ctx("pass", "below_rq", { lineLabel: "UN1114", substance: "Benzene", rq: 4.54, perPackage: 4, unit: "kg" }), "UN1114 has 4 kg per package of Benzene, under its reportable quantity of 4.54 kg — no RQ needed."],
  ["paper_rq", ctx("cannot_tell", "concentration_unknown", { lineLabel: "UN1993", substance: "Benzene", rq: 10, perPackage: 400, unit: "lb" }), "UN1993 is a mixture containing Benzene (RQ 10 lb); whether it needs \"RQ\" depends on how much of it is in the mix, which the BOL doesn't say."],
  ["paper_rq", ctx("cannot_tell", "technical_name_not_printed", { lineLabel: "UN1993" }), "UN1993 is an n.o.s. entry with no technical name, so whether it holds a listed hazardous substance can't be told."],
  ["paper_lq", ctx("fail", "not_authorised", { lineLabel: "UN1541", requiredPsn: "Acetone cyanohydrin, stabilized" }), "The BOL marks UN1541 as a Limited Quantity, but the table allows no Limited Quantity for Acetone cyanohydrin, stabilized."],
  ["paper_lq", ctx("fail", "claimed_not_printed", { lineLabel: "UN1203" }), "UN1203 is booked as a Limited Quantity, but the BOL doesn't say \"Limited Quantity\" or \"Ltd Qty\"."],
  ["paper_lq", ctx("pass", "authorised", { lineLabel: "UN1203", exceptionsRef: "150", positionVerified: false }), "UN1203 is marked Limited Quantity, which the table allows (49 CFR 173.150)."],
  ["paper_lq", ctx("fail", "lq_not_following", { lineLabel: "UN1203", exceptionsRef: "150" }), "UN1203's \"Limited Quantity\" words are printed ahead of its description; they must follow it."],
  ["paper_lq", ctx("cannot_tell", "lq_outside_description", { lineLabel: "UN1203", exceptionsRef: "150" }), "UN1203 is marked Limited Quantity somewhere on the line, but not in its description — check the words follow the description."],
  ["paper_marine_pollutant", ctx("fail", "required_not_printed", { lineLabel: "UN1541", requiredPsn: "Acetone cyanohydrin, stabilized", packagingKind: "bulk", vesselLeg: null }), "UN1541 (Acetone cyanohydrin, stabilized) is a marine pollutant in bulk, and the BOL doesn't say \"Marine Pollutant\"."],
  ["paper_marine_pollutant", ctx("pass", "not_required_non_bulk_highway", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant, but in non-bulk packages moving only by road the words are not required."],
  ["paper_marine_pollutant", ctx("pass", "excepted_oil_130_11", { lineLabel: "NA1993" }), "NA1993 is a marine pollutant, but on a move with no vessel leg the description naming it as an oil is enough."],
  ["paper_marine_pollutant", ctx("cannot_tell", "oil_exception_may_apply", { lineLabel: "NA1993" }), "NA1993 is a marine pollutant described as an oil; that excuses the \"Marine Pollutant\" words only for oil covered by 49 CFR part 130 on a move with no vessel leg — confirm both."],
  ["paper_marine_pollutant", ctx("pass", "excepted_small_package_171_4_c2", { lineLabel: "UN1541", perPackage: 4, unit: "L" }), "UN1541 is a marine pollutant, but at 4 L per package it is small enough to be exempt (49 CFR 171.4(c)(2))."],
  ["paper_marine_pollutant", ctx("cannot_tell", "package_quantity_unknown", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant; packages of 5 L or 5 kg or less are exempt, and the BOL doesn't show how much is in each package."],
  ["paper_marine_pollutant", ctx("cannot_tell", "physical_state_unknown", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant in small packages; whether they are exempt depends on whether it is a liquid (5 L) or a solid (5 kg), which isn't known."],
  ["paper_marine_pollutant", ctx("cannot_tell", "hazardous_substance_may_apply", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant in small packages, which are exempt unless it is also a hazardous substance or hazardous waste — check whether it is."],
  ["paper_marine_pollutant", ctx("cannot_tell", "applicability_unknown", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant; whether the BOL must say so depends on bulk packaging or a vessel leg, and neither is known."],
  ["paper_quantity_present", ctx("fail", "unit_missing", { lineLabel: "Line 1", value: 2 }), "Line 1 shows 2 with no unit — gallons, pounds or another unit has to be printed."],
  ["paper_quantity_present", ctx("pass", "bulk_package_count", { lineLabel: "UN1203", packaging: "1 cargo tank" }), "UN1203 gives its quantity as \"1 cargo tank\", which a bulk load may."],
  ["paper_quantity_present", ctx("pass", "cylinder_count", { lineLabel: "UN1075", packaging: "10 cylinders" }), "UN1075 gives its quantity as \"10 cylinders\", which cylinders may."],
  ["paper_package_count", ctx("pass", "printed", { lineLabel: "UN1203", packageCount: 1, packaging: "1 cargo tank" }), "UN1203 shows its number and type of packages (1 cargo tank)."],
  ["paper_package_count", ctx("fail", "count_missing", { lineLabel: "UN1203", packaging: "drums" }), "UN1203 says \"drums\" but not how many."],
  ["paper_package_count", ctx("fail", "type_missing", { lineLabel: "UN1203", packageCount: 4 }), "UN1203 shows 4 packages but not what kind (drums, cases, cylinders, …)."],
  ["paper_package_count", ctx("fail", "missing", { lineLabel: "UN1203" }), "UN1203 shows neither the number nor the type of packages."],
  ["paper_quantity_present", ctx("cannot_tell", "field_unconfirmed", { lineLabel: "UN1203", unconfirmed: ["hazmat.lines[0].quantity.value"] }), "Can't check the quantity on UN1203 yet: the reader isn't sure of hazmat.lines[0].quantity.value — confirm it against the paper first."],
  ["paper_hm_column", ctx("pass", "marked", { lineLabel: "Line 1", mark: "X", columnCaptionVerified: false }), "Line 1 is marked \"X\" in the HM column."],
  ["paper_hm_column", ctx("pass", "listed_first", { lineLabel: "UN1203" }), "UN1203 is listed ahead of the other freight on the paper, which identifies it as hazmat."],
  ["paper_hm_column", ctx("cannot_tell", "identification_method_not_read", { lineLabel: "UN1203", mixedPaper: true }), "UN1203 has no HM-column mark; if other freight is on this paper, check the hazmat lines are listed first or in a contrasting colour."],
  ["paper_hm_column", ctx("cannot_tell", "line_unresolved", { lineLabel: "UN9999" }), "Can't check the HM column on UN9999: the line doesn't match one Hazardous Materials Table entry, so there is nothing to compare it with. Pick the right entry first."],
  ["paper_er_phone", ctx("fail", "missing", {}, null), "The BOL has no emergency response telephone number."],
  ["paper_er_phone", ctx("pass", "excepted_172_604_d", { exceptions: ["d1_limited_quantity"] }, null), "Every hazmat line on this BOL is shipped as a limited quantity, so no emergency response telephone number is required (49 CFR 172.604(d))."],
  ["paper_er_phone", ctx("cannot_tell", "exception_may_apply", { unknownLines: ["UN3171"] }, null), "Can't tell whether this BOL needs an emergency response telephone number: UN3171 may be one of the materials 49 CFR 172.604(d) excepts — confirm the line first."],
  ["paper_er_phone", ctx("cannot_tell", "words_beside_number", { printed: "CALL SHIPPER 800 555 1212", digits: "8005551212", extension: null }, null), "The emergency number reads \"CALL SHIPPER 800 555 1212\" — check that the words are a name beside the number, not a call-back instruction; a number that needs a call back does not count."],
  ["paper_er_phone", ctx("fail", "not_numeric", { printed: "1-800-CHEMTREC", digits: "1800", extension: null }, null), "The emergency number \"1-800-CHEMTREC\" is spelled in letters; it has to be printed as digits."],
  ["paper_er_phone", ctx("cannot_tell", "number_shape_unrecognised", { printed: "(100) 424-9300", digits: "1004249300", extension: null }, null), "The emergency number \"(100) 424-9300\" isn't a US number with an area code or an international number with its \"+\" and country code — check it by eye."],
  ["paper_er_phone", ctx("pass", "international", { printed: "+44 20 7946 0958", digits: "442079460958", extension: null }, null), "The emergency number +44 20 7946 0958 is an international number with its country code."],
  ["paper_er_phone", ctx("fail", "not_a_number", { printed: "CALL SHIPPER", digits: "" }, null), "The emergency contact reads \"CALL SHIPPER\" — a phone number with area code is required, not words."],
  ["paper_er_phone", ctx("pass", "well_formed", { printed: "(800) 424-9300", digits: "8004249300", extension: null }, null), "The emergency number (800) 424-9300 is printed with its area code."],
  ["paper_er_phone", ctx("pass", "well_formed", { printed: "800-424-9300 ext. 22", digits: "8004249300", extension: "22" }, null), "The emergency number 800-424-9300 ext. 22 is printed with its area code."],
  ["paper_certification", ctx("fail", "missing", {}, null), "The shipper's certification is not on the BOL."],
  ["paper_certification", ctx("cannot_tell", "exception_may_apply", {}, null), "The shipper's certification is not on the BOL; that is fine only in a cargo tank the carrier supplied, or when the shipper hauls it as a private carrier and it won't be reshipped or transferred — and never for hazardous waste."],
  ["paper_certification", ctx("pass", "exempt", {}, null), "The shipper's certification is not on the BOL, and this load doesn't need one: it is not hazardous waste and moves in a cargo tank the carrier supplied, or with the shipper as a private carrier without being reshipped or transferred."],
  ["paper_page_complete", ctx("fail", "pages_missing", { of: 3, missingPages: [3] }, null), "The BOL has 3 pages and page 3 is missing."],
  ["paper_page_complete", ctx("fail", "pages_missing", { of: 4, missingPages: [2, 4] }, null), "The BOL has 4 pages and pages 2, 4 are missing."],
  ["paper_page_complete", ctx("cannot_tell", "pages_not_counted", { of: 2 }, null), "The BOL says it has 2 pages; check that all of them are here."],
  ["paper_page_complete", ctx("pass", "single_page", { pages: 1 }, null), "The BOL is a single page."],
  ["paper_page_complete", ctx("cannot_tell", "page_count_unknown", {}, null), "The BOL prints no page count, and how many pages it has wasn't recorded — if it runs past one page, each page must be numbered and page 1 must give the total."],
  ["paper_page_complete", ctx("fail", "multi_page_unnumbered", { pages: 2 }, null), "The BOL runs to 2 pages but doesn't give the total on page 1 (\"Page 1 of 2\")."],
  ["paper_page_complete", ctx("fail", "page_not_numbered", { of: 2, unnumberedImages: 1 }, null), "The BOL has 2 pages and 1 of the pages photographed carries no page number."],
  ["paper_page_complete", ctx("fail", "total_not_on_first_page", { of: 2 }, null), "The BOL has 2 pages, but page 1 doesn't say so — the total has to be on the first page."],
  ["paper_page_complete", ctx("fail", "numbering_inconsistent", { of: 2, pagesBeyond: [3] }, null), "The BOL says it has 2 pages but page 3 is also here — the numbering doesn't add up."],
];

describe("BOL finding catalogue (§5.3, D-DR7)", () => {
  it.each(CASES)("%s renders the dispatcher's sentence for a real context", (ruleId, c, expected) => {
    expect(BOL_FINDING_CATALOGUE[ruleId].sentence(c)).toBe(expected);
  });

  it("covers every rule with at least one failing context", () => {
    const failing = new Set(CASES.filter(([, c]) => c.outcome === "fail").map(([id]) => id));
    // paper_hm_column never fails by design (the reader cannot see order or colour) — its rule says why.
    expect(BOL_FINDING_RULE_IDS.filter((id) => !failing.has(id))).toEqual(["paper_hm_column"]);
  });

  it("cites §172.202(a)'s paragraphs as eCFR numbers them: (2) shipping name, (3) class, (4) packing group, (7) packages", () => {
    expect(BOL_FINDING_CATALOGUE.paper_psn_matches_hmt.cite).toBe("49 CFR 172.202(a)(2)");
    expect(BOL_FINDING_CATALOGUE.paper_class_pg_match.cite).toBe("49 CFR 172.202(a)(3)-(4)");
    expect(BOL_FINDING_CATALOGUE.paper_quantity_present.cite).toBe("49 CFR 172.202(a)(5)");
    expect(BOL_FINDING_CATALOGUE.paper_package_count.cite).toBe("49 CFR 172.202(a)(7)");
  });

  it("never promises an order check the reader could not make", () => {
    expect(BOL_FINDING_CATALOGUE.paper_sequence.howToFix).not.toMatch(/in that order/);
  });

  it("speaks of the emergency number in §172.604's words, not \"24-hour\"", () => {
    const e = BOL_FINDING_CATALOGUE.paper_er_phone;
    expect(e.howToFix).toContain("monitored at all times the hazardous material is in transportation");
    for (const [ruleId, c] of CASES) if (ruleId === "paper_er_phone") expect(e.sentence(c)).not.toMatch(/24-hour/);
  });

  it("gives every entry a CFR cite, a known actor and a fix", () => {
    for (const id of BOL_FINDING_RULE_IDS) {
      const e = BOL_FINDING_CATALOGUE[id];
      expect(e.cite).toMatch(/^49 CFR 172\.\d{3}/);
      expect(BOL_FINDING_ACTORS).toContain(e.actor);
      expect(e.howToFix.length).toBeGreaterThan(20);
    }
  });

  it("says who acts in the dispatcher's terms: the dangerous gaps stop the truck", () => {
    expect(BOL_FINDING_CATALOGUE.paper_er_phone.actor).toBe("driver_must_not_accept");
    expect(BOL_FINDING_CATALOGUE.paper_class_pg_match.actor).toBe("driver_must_not_accept");
    expect(BOL_FINDING_CATALOGUE.paper_hm_column.actor).toBe("information_only");
  });

  it("never leaks an empty placeholder into a sentence", () => {
    for (const [ruleId, c] of CASES) {
      const text = BOL_FINDING_CATALOGUE[ruleId].sentence(c);
      expect(text).not.toMatch(/undefined|null|\(\)|""|\s{2}/);
    }
  });
});
