import { describe, expect, it } from "vitest";
import { DS, GASOLINE, failed, ok, pline, result, rline, run } from "./paperAudit.fixtures.js";

/**
 * The basic-description rules of `auditPrintedPaper` (§5.1): sequence, PSN, class/PG, technical name,
 * quantity, HM column. One test per rule per outcome; each `cannot_tell` is a different reason.
 */

describe("paper_sequence — §172.202(a)(1)–(4) id, PSN, class, PG all printed", () => {
  it("passes a complete gasoline description, saying the order was not verified", () => {
    const r = result({ lines: [GASOLINE()] }, "paper_sequence");
    expect(r.outcome).toBe("pass");
    expect(r.facts.orderVerified).toBe(false);
    expect(r.facts.printed).toBe("UN1203, Gasoline, 3, II");
  });

  it("fails the first real BOL (F-DR11): HM column X, no id, no PSN, no class", () => {
    const lead = pline({ idText: null, psn: null, hazardClass: null, pg: null, hmColumnMark: "X", quantity: { value: 2, unit: null }, packaging: "pallets" });
    const r = result({ lines: [[lead, rline(failed("id_missing"))]] }, "paper_sequence");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("elements_missing");
    expect(r.facts.missing).toEqual(["id", "psn", "class"]);
  });

  it("fails a missing PG when the row requires one (single-PG entry, resolver flagged pg_missing)", () => {
    const r = result({ lines: [[pline({ pg: null }), rline(ok("UN1203-gasoline", "II", { findings: ["pg_missing"] }))]] }, "paper_sequence");
    expect(r.outcome).toBe("fail");
    expect(r.facts.missing).toEqual(["pg"]);
  });

  it("passes a gas with no PG — the row has none to print", () => {
    const lpg = pline({ idText: "UN1075", psn: "Petroleum gases, liquefied", hazardClass: "2.1", pg: null });
    expect(result({ lines: [[lpg, rline(ok("UN1075-petroleum-gases-liquefied", null))]] }, "paper_sequence").outcome).toBe("pass");
  });

  it("cannot tell whether a PG is owed when the line did not resolve", () => {
    const r = result({ lines: [[pline({ pg: null }), rline(failed("id_not_found"))]] }, "paper_sequence");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("line_unresolved");
  });

  it("cannot tell when a field it needs is Check, even though a value is there", () => {
    const r = result({ lines: [GASOLINE()], fieldStates: { "hazmat.lines[0].hazardClass": "check" } }, "paper_sequence");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("field_unconfirmed");
    expect(r.facts.unconfirmed).toEqual(["hazmat.lines[0].hazardClass"]);
  });

  it("reads a Not read null as unknown, never as missing", () => {
    const r = result({ lines: [[pline({ idText: null }), rline(failed("id_missing"))]], fieldStates: { "hazmat.lines[0].idText": "not_read" } }, "paper_sequence");
    expect(r.outcome).toBe("cannot_tell");
  });
});

describe("paper_psn_matches_hmt — the printed PSN is the row's (§172.202(a)(2) \"The proper shipping name prescribed for the material in Column (2)\")", () => {
  it("passes when the resolver matched the printed name under the dataset normaliser", () => {
    const r = result({ lines: [GASOLINE()] }, "paper_psn_matches_hmt");
    expect(r.outcome).toBe("pass");
    expect(r.facts.requiredPsn).toBe("Gasoline");
  });

  it("fails a name that matches no row under the printed id, listing the rows that do exist", () => {
    const r = result({ lines: [[pline({ psn: "Gas" }), rline(failed("psn_no_match", [{ entryId: "UN1203-gasoline", psn: "Gasoline" }]))]] }, "paper_psn_matches_hmt");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("psn_not_in_hmt");
    expect(r.facts.candidatePsns).toEqual(["Gasoline"]);
  });

  it("fails a line resolved by its id alone with no name printed", () => {
    const r = result({ lines: [[pline({ psn: null }), rline(ok("UN1203-gasoline", "II"))]] }, "paper_psn_matches_hmt");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("psn_missing");
    expect(r.facts.requiredPsn).toBe("Gasoline");
  });

  it("cannot tell on a line that never resolved", () => {
    expect(result({ lines: [[pline(), rline(failed("id_not_found"))]] }, "paper_psn_matches_hmt").reason).toBe("line_unresolved");
  });
});

describe("paper_class_pg_match — class, subsidiary and PG equal the row's (§172.202(a)(3) \"The hazard class or division number\", (a)(4) \"The packing group in Roman numerals\")", () => {
  it("passes gasoline 3 / II", () => {
    const r = result({ lines: [GASOLINE()] }, "paper_class_pg_match");
    expect(r.outcome).toBe("pass");
    expect(r.facts.requiredClass).toBe("3");
    expect(r.facts.requiredPg).toBe("II");
  });

  it("fails a PG that differs from the row's", () => {
    const r = result({ lines: [[pline({ pg: "III" }), rline(ok("UN1203-gasoline", "II", { findings: ["pg_mismatch"] }))]] }, "paper_class_pg_match");
    expect(r.outcome).toBe("fail");
    expect(r.facts.pgProblem).toBe("differs");
    expect(r.facts.printedPg).toBe("III");
  });

  it("fails a PG printed on a gas that has none", () => {
    const lpg = pline({ idText: "UN1075", psn: "Petroleum gases, liquefied", hazardClass: "2.1", pg: "II" });
    const r = result({ lines: [[lpg, rline(ok("UN1075-petroleum-gases-liquefied", null, { findings: ["pg_present_on_no_pg_entry"] }))]] }, "paper_class_pg_match");
    expect(r.facts.pgProblem).toBe("not_allowed");
  });

  it("fails a class that contradicts the row, reading the row from the resolver's single candidate", () => {
    const r = result({ lines: [[pline({ hazardClass: "8" }), rline(failed("class_mismatch", [{ entryId: "UN1203-gasoline", psn: "Gasoline" }]))]] }, "paper_class_pg_match");
    expect(r.outcome).toBe("fail");
    expect(r.facts.classProblem).toBe("differs");
    expect(r.facts.requiredClass).toBe("3");
  });

  it("fails a missing PG on a multi-PG n.o.s. entry, naming the PGs the row allows", () => {
    const fl = pline({ idText: "UN1993", psn: "Flammable liquids, n.o.s. (toluene)", pg: null });
    const r = result({ lines: [[fl, rline(failed("pg_required_ambiguous", [{ entryId: "UN1993-flammable-liquids-n-o-s", psn: "Flammable liquids, n.o.s." }]))]] }, "paper_class_pg_match");
    expect(r.facts.pgProblem).toBe("missing");
    expect(r.facts.requiredPg).toEqual(["I", "II", "III"]);
  });

  it("cannot tell on an unresolved line", () => {
    expect(result({ lines: [[pline(), rline(null)]] }, "paper_class_pg_match").outcome).toBe("cannot_tell");
  });
});

describe("paper_technical_name — G entries show a technical name (§172.203(k))", () => {
  const fl = (over = {}) => pline({ idText: "UN1993", psn: "Flammable liquids, n.o.s.", pg: "II", ...over });
  const flRes = rline(ok("UN1993-flammable-liquids-n-o-s", "II"));
  // One hazardous component, as the SDS would say: §172.203(k)(1)'s two-name rule then does not reach it.
  const single = rline(ok("UN1993-flammable-liquids-n-o-s", "II"), { hazardousComponents: 1 });

  it("passes a G entry with the technical name printed separately", () => {
    expect(result({ lines: [[fl({ technicalName: "toluene" }), single]] }, "paper_technical_name").outcome).toBe("pass");
  });
  it("passes a G entry whose PSN carries the name in parentheses", () => {
    expect(result({ lines: [[fl({ psn: "Flammable liquids, n.o.s. (toluene)" }), single]] }, "paper_technical_name").reason).toBe("printed");
  });
  it("passes an entry without the G symbol — nothing is owed", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_technical_name").reason).toBe("not_required");
  });
  it("fails a G entry with no technical name anywhere", () => {
    const r = result({ lines: [[fl(), flRes]] }, "paper_technical_name");
    expect(r.outcome).toBe("fail");
    expect(r.facts.requiredPsn).toBe("Flammable liquids, n.o.s.");
  });
  it("cannot tell when the dataset view does not carry the HMT symbols", () => {
    const bare = { ...DS, entries: DS.entries.map(({ symbols: _s, ...e }) => e) };
    const r = result({ lines: [[fl(), flRes]], resolved: { dataset: bare } }, "paper_technical_name");
    expect(r.reason).toBe("requirement_not_in_dataset");
  });
});

describe("paper_quantity_present — total quantity with its unit (§172.202(a)(5))", () => {
  it("passes 8000 gal", () => {
    expect(result({ lines: [GASOLINE()] }, "paper_quantity_present").reason).toBe("printed");
  });
  it("passes \"1 cargo tank\" with no number — (a)(5)(iii)(A) \"Bulk packages, provided some indication of the total quantity is shown\"", () => {
    const r = result({ lines: [[pline({ quantity: { value: null, unit: null } }), rline(ok("UN1203-gasoline", "II"))]] }, "paper_quantity_present");
    expect(r.outcome).toBe("pass");
    expect(r.reason).toBe("bulk_package_count");
  });
  it("fails a number with no unit", () => {
    const r = result({ lines: [[pline({ quantity: { value: 2, unit: null }, packaging: "pallets" }), rline(null, { packagingKind: "non_bulk" })]] }, "paper_quantity_present");
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("unit_missing");
  });
  it("fails a line with no quantity at all", () => {
    expect(result({ lines: [[pline({ quantity: { value: null, unit: null }, packaging: "drums", packageCount: 4 }), rline(null, { packagingKind: "non_bulk" })]] }, "paper_quantity_present").reason).toBe("missing");
  });
  it("cannot tell when the quantity is Not read", () => {
    const r = result({ lines: [GASOLINE()], fieldStates: { "hazmat.lines[0].quantity.value": "not_read" } }, "paper_quantity_present");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.facts.unconfirmed).toEqual(["hazmat.lines[0].quantity.value"]);
  });
});

describe("paper_hm_column — hazmat identified on a mixed paper (§172.201(a)(1))", () => {
  it("passes a line marked X", () => {
    expect(result({ lines: [[pline({ hmColumnMark: "X" }), rline(null)]] }, "paper_hm_column").reason).toBe("marked");
  });
  it("passes an unmarked line when the paper carries only hazmat", () => {
    expect(result({ lines: [GASOLINE()], resolved: { mixedPaper: false } }, "paper_hm_column").reason).toBe("not_mixed");
  });
  it("cannot tell on a mixed paper — listing first or colour also satisfy it, and neither is read", () => {
    const r = result({ lines: [GASOLINE()], resolved: { mixedPaper: true } }, "paper_hm_column");
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("identification_method_not_read");
  });
  it("cannot tell when the mark itself is Check", () => {
    expect(result({ lines: [GASOLINE()], fieldStates: { "hazmat.lines[0].hmColumnMark": "check" } }, "paper_hm_column").reason).toBe("field_unconfirmed");
  });
});

describe("auditPrintedPaper — shape", () => {
  it("answers every line rule once per line and every document rule once", () => {
    const rs = run({ lines: [GASOLINE(), GASOLINE()] });
    expect(rs.filter((r) => r.lineIndex === 1)).toHaveLength(10);
    expect(rs.filter((r) => r.lineIndex === null)).toHaveLength(3);
  });
  it("returns nothing for a paper with no hazmat lines", () => {
    expect(run({ lines: [] })).toEqual([]);
  });
});
