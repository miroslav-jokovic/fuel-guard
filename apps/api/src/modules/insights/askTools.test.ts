import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOL_NAMES } from "@silvicom/shared";
import { TOOLS, toolsFor } from "./askTools.js";

/** The model's tool definitions and the access contract name the same tools (F21 R5). */
describe("askTools", () => {
  it("every definition has an access rule and every access rule has a definition", () => {
    expect([...TOOLS.map((t) => t.name)].sort()).toEqual([...ASSISTANT_TOOL_NAMES].sort());
  });
  it("toolsFor gives exactly the allowed tools, in the contract's order", () => {
    expect(toolsFor(["fleet_roster", "fuel_report"]).map((t) => t.name)).toEqual(["fuel_report", "fleet_roster"]);
    expect(toolsFor([])).toEqual([]);
  });
});
