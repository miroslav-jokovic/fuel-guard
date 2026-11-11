import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOL_NAMES, MODULE_KEYS, assistantToolsFor } from "@silvicom/shared";

const ALL = new Set(MODULE_KEYS);
import { suggestionsFor } from "./suggestions";

/** A suggestion is a question this person's tools can answer (F21 R5, D-AI1) — never a button that apologises. */
describe("suggestionsFor", () => {
  it("offers the page's own questions first when every tool is allowed", () => {
    const qs = suggestionsFor("/fuel-spend", ASSISTANT_TOOL_NAMES, 4);
    expect(qs[0]).toBe("Fuel cost per mile last quarter, compared with the quarter before");
    expect(qs).toHaveLength(4);
  });

  it("drops every question whose tool the person lacks: a dispatcher is offered no idling or driver-score questions", () => {
    const qs = suggestionsFor("/idling", assistantToolsFor("dispatcher", null, ALL), 6);
    expect(qs.some((q) => /idl|safety score/i.test(q))).toBe(false);
    expect(qs.length).toBeGreaterThan(0);
  });

  it("offers the Fleet report's finance questions to an accountant, and none of them to a fleet manager (Q-AI5)", () => {
    const accountant = suggestionsFor("/fleet-report", assistantToolsFor("accountant", null, ALL), 4);
    expect(accountant[0]).toBe("What was our all-in cost per mile last month?");
    const manager = suggestionsFor("/fleet-report", assistantToolsFor("fleet_manager", null, ALL), 6);
    expect(manager.some((q) => /cost per mile last month|income statement|owner-operators|earned the most/i.test(q))).toBe(false);
  });

  it("never offers 'moving right now' to a carrier without Dispatch (R6b)", () => {
    const without = suggestionsFor("/", assistantToolsFor("admin", null, new Set()), 10);
    expect(without.some((q) => /moving right now/i.test(q))).toBe(false);
    const withIt = suggestionsFor("/", assistantToolsFor("admin", null, ALL), 10);
    expect(withIt.some((q) => /moving right now/i.test(q))).toBe(true);
  });

  it("offers nothing when nothing is allowed", () => {
    expect(suggestionsFor("/", [], 4)).toEqual([]);
  });
});
