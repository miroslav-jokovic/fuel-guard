import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { FieldEvidence, PaperAuditView } from "@silvicom/shared";
import { bolFindings, fieldChoices } from "./bolFindings";
import BolFindingsPanel from "./BolFindingsPanel.vue";

/**
 * The paper audit on screen (§7A N6 part 3). What must hold: every result is worded by the catalogue, sorted
 * by what someone must do — a paper the driver must refuse before one the shipper must fix — the passed
 * checks are counted and folded away, and a clean paper says so.
 */
type Result = PaperAuditView["results"][number];
const r = (ruleId: string, outcome: Result["outcome"], reason: string, facts: Result["facts"] = {}, lineIndex: number | null = 0): Result =>
  ({ ruleId, outcome, reason, facts: { lineLabel: "UN1263", ...facts }, lineIndex });
const audit = (results: Result[]): PaperAuditView => ({ datasetVersion: "2026.07.1", results });

const MIXED = audit([
  r("paper_quantity_present", "fail", "missing"),
  r("paper_class_pg_match", "fail", "class_or_pg_wrong", { pgProblem: "missing", requiredPg: ["II"] }),
  r("paper_er_phone", "cannot_tell", "exception_may_apply", { unknownLines: ["UN1263"] }, null),
  r("paper_psn_matches_hmt", "pass", "matched", { requiredPsn: "Paint" }),
  r("paper_future_rule", "fail", "x"),
]);

describe("bolFindings", () => {
  it("sorts each result by outcome, the driver's refusals before the shipper's fixes, in the catalogue's words", () => {
    const f = bolFindings(MIXED)!;
    expect(f.wrong.map((x) => [x.key, x.actor])).toEqual([
      ["paper_class_pg_match:0", "driver_must_not_accept"],
      ["paper_quantity_present:0", "shipper_must_correct"],
    ]);
    expect(f.wrong[1]!.sentence).toBe("UN1263 shows no total quantity.");
    expect(f.wrong[1]!.cite).toBe("49 CFR 172.202(a)(5)");
    expect(f.check.map((x) => x.key)).toEqual(["paper_er_phone:doc"]);
    expect(f.passed.map((x) => x.sentence)).toEqual(['UN1263\'s shipping name matches the table ("Paint").']);
    expect(f.datasetVersion).toBe("2026.07.1");
  });

  it("hands the right classes in the wrong punctuation to the shipper, after the driver's refusals (D-PC2)", () => {
    const f = bolFindings(audit([
      r("paper_class_pg_match", "fail", "class_format", { lineLabel: "UN2924", printedClass: "3, 8", requiredClass: "3 (8)", classProblem: "format", pgProblem: null }),
      r("paper_quantity_present", "fail", "missing"),
      r("paper_class_pg_match", "fail", "class_or_pg_wrong", { lineLabel: "UN1993", printedClass: "8", requiredClass: "3", classProblem: "differs", pgProblem: null }, 1),
    ]))!;
    expect(f.wrong.map((x) => [x.key, x.actor])).toEqual([
      ["paper_class_pg_match:1", "driver_must_not_accept"],
      ["paper_class_pg_match:0", "shipper_must_correct"],
      ["paper_quantity_present:0", "shipper_must_correct"],
    ]);
    expect(f.wrong[1]!.sentence).toContain('prints class "3, 8": the right classes, but §172.202(a)(3)');
  });

  it("says once per line and cause what stopped several checks, naming each check it stopped", () => {
    const f = bolFindings(audit([
      r("paper_psn_matches_hmt", "cannot_tell", "line_unresolved", { lineLabel: "5503615" }, 2),
      r("paper_rq", "cannot_tell", "line_unresolved", { lineLabel: "5503615" }, 2),
      r("paper_rq", "cannot_tell", "field_unconfirmed", { unconfirmed: ["hazmat.lines[1].packageCount"] }, 1),
      r("paper_quantity_present", "cannot_tell", "field_unconfirmed", { unconfirmed: ["hazmat.lines[1].packageCount"] }, 1),
      r("paper_class_pg_match", "cannot_tell", "field_unconfirmed", { unconfirmed: ["hazmat.lines[1].pg"] }, 1),
    ]))!;
    expect(f.check.map((x) => x.sentence)).toEqual([
      "Can't check the shipping name and the RQ marking on 5503615: the line doesn't match one Hazardous Materials Table entry, so there is nothing to compare it with. Pick the right entry first.",
      "Can't check the RQ marking and the quantity on UN1263 yet: the reader isn't sure of the package count — confirm it against the paper first.",
      "Can't check the class and packing group on UN1263 yet: the reader isn't sure of the packing group — confirm it against the paper first.",
    ]);
    expect(f.check[0]!.cite).toBe("49 CFR 172.202(a)(2); 49 CFR 172.203(c)");
  });

  it("answers nothing without an audit", () => {
    expect(bolFindings(null)).toBeNull();
  });
});

describe("BolFindingsPanel", () => {
  it("shows what is wrong with who acts, what to check, and folds the passes behind their count", async () => {
    const w = mount(BolFindingsPanel, { props: { findings: bolFindings(MIXED)! } });
    const wrong = w.findAll("[data-testid='bol-finding-wrong']");
    expect(wrong.map((x) => x.find("p").text())).toEqual([
      "The BOL for UN1263 prints no packing group (the table requires one of PG II).",
      "UN1263 shows no total quantity.",
    ]);
    expect(wrong[0]!.text()).toContain("Do not accept the BOL until it is corrected.");
    expect(wrong[1]!.text()).toContain("The shipper must correct it.");
    expect(w.findAll("[data-testid='bol-finding-check']")).toHaveLength(1);
    expect(w.find("[data-testid='bol-findings-clean']").exists()).toBe(false);
    expect(w.find("[data-testid='bol-findings-passed']").exists()).toBe(false);
    await w.find("button").trigger("click");
    expect(w.findAll("[data-testid='bol-findings-passed'] li")).toHaveLength(1);
  });

  it("never calls a paper clean while anything is left to check", () => {
    const w = mount(BolFindingsPanel, { props: { findings: bolFindings(audit([r("paper_er_phone", "cannot_tell", "exception_may_apply", { unknownLines: ["UN1263"] }, null)]))! } });
    expect(w.find("[data-testid='bol-findings-clean']").exists()).toBe(false);
  });

  it("says every check passed on a clean paper", () => {
    const w = mount(BolFindingsPanel, { props: { findings: bolFindings(audit([r("paper_psn_matches_hmt", "pass", "matched", { requiredPsn: "Paint" })]))! } });
    expect(w.find("[data-testid='bol-findings-clean']").text()).toBe("Every check passed.");
  });
});

// Q-RC5: what a person may say the page prints in a field a check waits on.
describe("fieldChoices", () => {
  const ev = (path: string, a: unknown, b: unknown): FieldEvidence => ({ path, value: a as never, status: "check", ruleVersion: "12", sources: [
    { reader: "passA", page: null, bbox: null, value: a as never }, { reader: "passB", page: null, bbox: null, value: b as never }] });

  it("offers the two readings, each once, never a blank one, in the dispatcher's words", () => {
    const evidence = [ev("hazmat.lines[0].packageCount", 9, 6), ev("hazmat.lines[1].packageCount", 4, 4.0), ev("hazmat.lines[2].packageCount", null, 6)];
    expect(fieldChoices(["hazmat.lines[0].packageCount"], evidence)).toEqual([
      { path: "hazmat.lines[0].packageCount", label: "the package count", options: [{ value: 9, text: "“9”" }, { value: 6, text: "“6”" }] },
    ]);
    expect(fieldChoices(["hazmat.lines[1].packageCount"], evidence)[0]!.options).toHaveLength(1);
    expect(fieldChoices(["hazmat.lines[2].packageCount"], evidence)[0]!.options).toEqual([{ value: 6, text: "“6”" }]);
  });

  it("asks yes or no on a yes/no field, whatever a reader that saw nothing read", () => {
    expect(fieldChoices(["hazmat.shipperCertification"], [ev("hazmat.shipperCertification", null, true)])[0]!.options.map((o) => o.value)).toEqual([true, false]);
  });

  it("offers nothing where no reader read anything, or the read holds no such field", () => {
    expect(fieldChoices(["hazmat.lines[0].pg"], [ev("hazmat.lines[0].pg", null, null)])).toEqual([]);
    expect(fieldChoices(["hazmat.lines[9].pg"], [])).toEqual([]);
  });

  it("puts the choices under the grouped 'confirm it first' line, and the panel emits the one picked", async () => {
    const r: Result = { ruleId: "paper_rq", outcome: "cannot_tell", reason: "field_unconfirmed", lineIndex: 0, facts: { lineLabel: "UN1263", unconfirmed: ["hazmat.lines[0].packageCount"] } };
    const findings = bolFindings({ datasetVersion: "t", results: [r] }, [ev("hazmat.lines[0].packageCount", 9, 6)])!;
    expect(findings.check[0]!.choices).toHaveLength(1);
    const w = mount(BolFindingsPanel, { props: { findings } });
    await w.findAll("[data-testid='bol-finding-choice'] button")[1]!.trigger("click");
    expect(w.emitted("check")).toEqual([["hazmat.lines[0].packageCount", 6]]);
  });
});
