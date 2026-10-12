import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { PaperAuditView } from "@silvicom/shared";
import { bolFindings } from "./bolFindings";
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
