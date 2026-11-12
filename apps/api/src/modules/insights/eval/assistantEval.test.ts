import { describe, expect, it, vi } from "vitest";
import { ASSISTANT_TOOL_NAMES, assistantToolsFor, MODULE_KEYS, type ModuleSet } from "@silvicom/shared";

/**
 * Ask AI's eval set and its scorer (F21 R7). The set is checked for honesty (every expected tool
 * exists and is one the case's role is actually given, every real question is unique), and the
 * scorer for each way an answer can be wrong. The runner is checked with `askData` mocked: the real
 * model is asked only by `eval:assistant`, never here.
 */
const askData = vi.fn();
vi.mock("../askData.js", () => ({ askData: (...a: unknown[]) => askData(...a) }));
const { ASSISTANT_EVAL_SET } = await import("./assistantEvalSet.js");
const { scoreCase, runAssistantEval, latencyPercentile } = await import("./assistantEval.js");

const ALL = new Set(MODULE_KEYS) as ModuleSet;
const usage = { model: "m", rounds: 1, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costMicroUsd: 1800 };
const trace = (tools: Array<{ name: string; input?: unknown; error?: string }>, answer = "ok", outcome = "answered") =>
  ({ answer, tools: tools.map((t) => ({ input: {}, ...t })), usage, outcome }) as never;
const byId = (id: string) => ASSISTANT_EVAL_SET.find((c) => c.id === id)!;

describe("ASSISTANT_EVAL_SET — honest by construction", () => {
  it("every expected tool exists and is one the case's role is given; every id and real question is unique", () => {
    for (const c of ASSISTANT_EVAL_SET) {
      const tools = assistantToolsFor(c.role, null, ALL);
      for (const t of c.expectTools) {
        expect(ASSISTANT_TOOL_NAMES, c.id).toContain(t);
        expect(tools, `${c.id}: a ${c.role} is not given ${t}`).toContain(t);
      }
    }
    expect(new Set(ASSISTANT_EVAL_SET.map((c) => c.id)).size).toBe(ASSISTANT_EVAL_SET.length);
    const real = ASSISTANT_EVAL_SET.filter((c) => c.kind === "real").map((c) => c.question.toLowerCase());
    expect(new Set(real).size).toBe(real.length);
  });

  it("a refusal case's role really has no tool that could answer it", () => {
    expect(assistantToolsFor("recruiter", null, ALL).some((t) => t.startsWith("fuel"))).toBe(false);
    expect(assistantToolsFor("dispatcher", null, ALL)).not.toContain("finance_report");
    expect(ASSISTANT_EVAL_SET.filter((c) => c.kind === "role").every((c) => c.expectTools.length === 0)).toBe(true);
  });

  it("every tool the reporting track built is asked at least once", () => {
    const asked = new Set(ASSISTANT_EVAL_SET.flatMap((c) => c.expectTools));
    for (const t of ["fuel_report", "finance_report", "income_statement", "idle_report", "fleet_now", "loads_by_truck", "ifta_report", "maintenance_cost", "card_holds", "driver_file_expirations", "annual_inspections_due", "recruiting_counts"]) {
      expect(asked, t).toContain(t);
    }
  });
});

describe("scoreCase", () => {
  it("passes the expected tool with the expected input, units compared as units", () => {
    const c = byId("mpg-nine-units");
    const units = ["Unit 748", "751", "#762", "763", "784", "785", "786", "787", "788"];
    expect(scoreCase(c, trace([{ name: "fuel_report", input: { units, period: "last_month" } }]))).toMatchObject({ pass: true, why: [] });
  });

  it("fails a wrong tool, a missing unit, a failed call, and an ending that is not an answer", () => {
    const c = byId("mpg-nine-units");
    expect(scoreCase(c, trace([{ name: "fuel_ranking" }])).why).toEqual(["expected fuel_report, called fuel_ranking"]);
    expect(scoreCase(c, trace([{ name: "fuel_report", input: { units: ["748"] } }])).why[0]).toMatch(/^fuel_report\.units was \["748"\]/);
    // A call that failed is not an answer, even with nothing else to fault.
    expect(scoreCase(byId("drivers-moving"), trace([{ name: "fleet_now", error: "timeout" }])).why).toEqual(["expected fleet_now, called fleet_now"]);
    expect(scoreCase(byId("drivers-moving"), trace([{ name: "fleet_now" }], "…", "step_limit")).why).toEqual(["ended as step_limit"]);
  });

  it("a refusal case fails on any tool call and on an answer that does not say it cannot", () => {
    const c = byId("recruiter-no-fuel");
    expect(scoreCase(c, trace([], "I can't answer fuel questions with your access."))).toMatchObject({ pass: true });
    expect(scoreCase(c, trace([{ name: "fleet_roster" }], "I can't")).why).toEqual(["called fleet_roster where no tool should be reachable"]);
    expect(scoreCase(c, trace([], "Fuel spend was $412,380.")).why).toEqual([`answer does not mention ${c.mustMention![0]}`]);
  });
});

describe("runAssistantEval", () => {
  it("asks each case with its role's tools and history, through the endpoint's own loop, and totals the cost", async () => {
    askData.mockReset();
    askData.mockResolvedValue(trace([{ name: "fuel_report" }]));
    const cases = [byId("follow-up-month-before"), byId("recruiter-no-fuel")];
    const run = await runAssistantEval({} as never, {} as never, "org-1", cases);
    expect(askData.mock.calls[0]!.slice(2, 5)).toEqual(["org-1", "and the month before?", assistantToolsFor("admin", null, ALL)]);
    expect(askData.mock.calls[0]![6]).toEqual(cases[0]!.history);
    expect(askData.mock.calls[1]![4]).toEqual(assistantToolsFor("recruiter", null, ALL));
    expect(askData.mock.calls[1]![6]).toEqual([]);
    expect(run).toMatchObject({ passed: 1, total: 2, costMicroUsd: 3600 });
  });

  it("hands each answer's text to the caller beside its verdict, and never puts it in a verdict --record would commit", async () => {
    askData.mockReset();
    const answer = "Unit 748 (Jane Driver) spent $4,812.33 on fuel.";
    askData.mockResolvedValue(trace([{ name: "fuel_report" }], answer));
    const seen: Array<[string, string]> = [];
    const run = await runAssistantEval({} as never, {} as never, "org-1", [byId("spend-and-mpg-last-month")], (v, a) => seen.push([v.id, a]));
    expect(seen).toEqual([["spend-and-mpg-last-month", answer]]);
    // What `--record` writes is `run.verdicts`; none of the answer may be in it.
    expect(JSON.stringify(run.verdicts)).not.toContain("Jane Driver");
    expect(JSON.stringify(run.verdicts)).not.toContain("4,812");
  });
});

describe("answer time (Step 2d's measurement)", () => {
  it("times each whole answer around the endpoint's own loop, and reports the median and p90 by nearest rank", async () => {
    askData.mockReset();
    let clock = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    // Each answer takes longer than the last: 1 s, 2 s, 3 s, 4 s.
    askData.mockImplementation(async () => {
      clock += 1000 * askData.mock.calls.length;
      return trace([{ name: "fuel_report" }]);
    });
    const cases = [byId("spend-and-mpg-last-month"), byId("top-stations"), byId("cost-per-mile"), byId("drivers-moving")];
    const run = await runAssistantEval({} as never, {} as never, "org-1", cases);
    now.mockRestore();
    expect(run.verdicts.map((v) => v.latencyMs)).toEqual([1000, 2000, 3000, 4000]);
    expect(run.latency).toEqual({ p50Ms: 2000, p90Ms: 4000, maxMs: 4000 });
  });

  it("nearest rank: no answer time is invented between two measured ones", () => {
    expect(latencyPercentile([5000, 1000, 3000], 0.5)).toBe(3000);
    expect(latencyPercentile([], 0.5)).toBe(0);
  });
});
