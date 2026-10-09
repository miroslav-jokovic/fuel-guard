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
  ["paper_sequence", ctx("pass", "all_elements_printed", { lineLabel: "UN1203", printed: "UN1203, Gasoline, 3, II", orderVerified: false }), "UN1203 prints all four parts (UN1203, Gasoline, 3, II); check by eye that they read in that order — the reader does not record it."],
  ["paper_psn_matches_hmt", ctx("fail", "psn_not_in_hmt", { lineLabel: "UN1203", printedPsn: "Gas", candidatePsns: ["Gasoline"] }), "The BOL calls UN1203 \"Gas\", which is not a proper shipping name for that number (the table lists: Gasoline)."],
  ["paper_psn_matches_hmt", ctx("fail", "psn_missing", { lineLabel: "UN1203", requiredPsn: "Gasoline" }), "The BOL shows UN1203 with no shipping name; the table's name is \"Gasoline\"."],
  ["paper_psn_matches_hmt", ctx("pass", "matched", { lineLabel: "UN1203", printedPsn: "Gasoline", requiredPsn: "Gasoline" }), "UN1203's shipping name matches the table (\"Gasoline\")."],
  ["paper_class_pg_match", ctx("fail", "class_or_pg_wrong", { lineLabel: "UN1203", printedClass: "3", printedPg: null, requiredClass: "3", requiredPg: "II", classProblem: null, pgProblem: "missing" }), "The BOL for UN1203 prints no packing group (the table requires PG II)."],
  ["paper_class_pg_match", ctx("fail", "class_or_pg_wrong", { lineLabel: "UN1075", printedClass: "2.1", printedPg: "II", requiredClass: "2.1", requiredPg: null, classProblem: null, pgProblem: "not_allowed" }), "The BOL for UN1075 prints PG II, but this material has no packing group."],
  ["paper_class_pg_match", ctx("fail", "class_or_pg_wrong", { lineLabel: "UN1993", printedClass: "8", printedPg: null, requiredClass: "3", requiredPg: ["I", "II", "III"], classProblem: "differs", pgProblem: "missing" }), "The BOL for UN1993 prints class 8 where the table says 3 and prints no packing group (the table requires one of PG I, II and III)."],
  ["paper_class_pg_match", ctx("pass", "matches", { lineLabel: "UN1203", requiredClass: "3", requiredPg: "II" }), "UN1203's class 3 and PG II match the table."],
  ["paper_technical_name", ctx("fail", "missing", { lineLabel: "UN1993", requiredPsn: "Flammable liquids, n.o.s." }), "UN1993 is an n.o.s. entry (\"Flammable liquids, n.o.s.\") and the BOL doesn't name what is actually in it."],
  ["paper_technical_name", ctx("pass", "printed", { lineLabel: "UN1993", technicalName: "toluene" }), "UN1993 names its contents (toluene), as an n.o.s. entry must."],
  ["paper_technical_name", ctx("cannot_tell", "requirement_not_in_dataset", { lineLabel: "UN1993", needs: "HMT column 1 symbols" }), "Can't check the technical name on UN1993: the regulatory data this check needs (HMT column 1 symbols) isn't in the loaded dataset version."],
  ["paper_rq", ctx("fail", "rq_not_printed", { lineLabel: "UN1114", substance: "Benzene", rq: 10, perPackage: 55, unit: "lb" }), "UN1114 has 55 lb per package of Benzene, at or over its reportable quantity of 10 lb, but the BOL doesn't say \"RQ\"."],
  ["paper_rq", ctx("pass", "below_rq", { lineLabel: "UN1114", substance: "Benzene", rq: 4.54, perPackage: 4, unit: "kg" }), "UN1114 has 4 kg per package of Benzene, under its reportable quantity of 4.54 kg — no RQ needed."],
  ["paper_rq", ctx("cannot_tell", "concentration_unknown", { lineLabel: "UN1993", substance: "Benzene", rq: 10, perPackage: 400, unit: "lb" }), "UN1993 is a mixture containing Benzene (RQ 10 lb); whether it needs \"RQ\" depends on how much of it is in the mix, which the BOL doesn't say."],
  ["paper_rq", ctx("cannot_tell", "technical_name_not_printed", { lineLabel: "UN1993" }), "UN1993 is an n.o.s. entry with no technical name, so whether it holds a listed hazardous substance can't be told."],
  ["paper_lq", ctx("fail", "not_authorised", { lineLabel: "UN1541", requiredPsn: "Acetone cyanohydrin, stabilized" }), "The BOL marks UN1541 as a Limited Quantity, but the table allows no Limited Quantity for Acetone cyanohydrin, stabilized."],
  ["paper_lq", ctx("fail", "claimed_not_printed", { lineLabel: "UN1203" }), "UN1203 is booked as a Limited Quantity, but the BOL doesn't say \"Limited Quantity\" or \"Ltd Qty\"."],
  ["paper_lq", ctx("pass", "authorised", { lineLabel: "UN1203", exceptionsRef: "150" }), "UN1203 is marked Limited Quantity, which the table allows (49 CFR 173.150)."],
  ["paper_marine_pollutant", ctx("fail", "required_not_printed", { lineLabel: "UN1541", requiredPsn: "Acetone cyanohydrin, stabilized", packagingKind: "bulk", vesselLeg: null }), "UN1541 (Acetone cyanohydrin, stabilized) is a marine pollutant in bulk, and the BOL doesn't say \"Marine Pollutant\"."],
  ["paper_marine_pollutant", ctx("pass", "not_required_non_bulk_highway", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant, but in non-bulk packages moving only by road the words are not required."],
  ["paper_marine_pollutant", ctx("cannot_tell", "applicability_unknown", { lineLabel: "UN1541" }), "UN1541 is a marine pollutant; whether the BOL must say so depends on bulk packaging or a vessel leg, and neither is known."],
  ["paper_quantity_present", ctx("fail", "unit_missing", { lineLabel: "Line 1", value: 2 }), "Line 1 shows 2 with no unit — gallons, pounds or another unit has to be printed."],
  ["paper_quantity_present", ctx("pass", "bulk_cargo_tank", { lineLabel: "UN1203", packaging: "1 cargo tank" }), "UN1203 gives its quantity as \"1 cargo tank\", which a bulk load may."],
  ["paper_quantity_present", ctx("cannot_tell", "field_unconfirmed", { lineLabel: "UN1203", unconfirmed: ["hazmat.lines[0].quantity.value"] }), "Can't check the quantity on UN1203 yet: the reader isn't sure of hazmat.lines[0].quantity.value — confirm it against the paper first."],
  ["paper_hm_column", ctx("pass", "marked", { lineLabel: "Line 1", mark: "X" }), "Line 1 is marked \"X\" in the HM column."],
  ["paper_hm_column", ctx("cannot_tell", "identification_method_not_read", { lineLabel: "UN1203", mixedPaper: true }), "UN1203 has no HM-column mark; if other freight is on this paper, check the hazmat lines are listed first or in a contrasting colour."],
  ["paper_hm_column", ctx("cannot_tell", "line_unresolved", { lineLabel: "UN9999" }), "Can't check the HM column on UN9999: the line doesn't match one Hazardous Materials Table entry, so there is nothing to compare it with. Pick the right entry first."],
  ["paper_er_phone", ctx("fail", "missing", {}, null), "The BOL has no 24-hour emergency phone number."],
  ["paper_er_phone", ctx("fail", "not_a_number", { printed: "CALL SHIPPER", digits: "" }, null), "The emergency contact reads \"CALL SHIPPER\" — a phone number with area code is required, not words."],
  ["paper_er_phone", ctx("pass", "well_formed", { printed: "(800) 424-9300", digits: "8004249300" }, null), "The emergency number (800) 424-9300 is printed."],
  ["paper_certification", ctx("fail", "missing", {}, null), "The shipper's certification is not on the BOL."],
  ["paper_certification", ctx("cannot_tell", "exception_may_apply", {}, null), "The shipper's certification is not on the BOL; that is fine only for a carrier-supplied cargo tank or a private carrier's own product."],
  ["paper_certification", ctx("pass", "exempt", {}, null), "The shipper's certification is not on the BOL, and this load doesn't need one (carrier-supplied tank or own product)."],
  ["paper_page_complete", ctx("fail", "pages_missing", { of: 3, missingPages: [3] }, null), "The BOL has 3 pages and page 3 is missing."],
  ["paper_page_complete", ctx("fail", "pages_missing", { of: 4, missingPages: [2, 4] }, null), "The BOL has 4 pages and pages 2, 4 are missing."],
  ["paper_page_complete", ctx("cannot_tell", "pages_not_counted", { of: 2 }, null), "The BOL says it has 2 pages; check that all of them are here."],
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
