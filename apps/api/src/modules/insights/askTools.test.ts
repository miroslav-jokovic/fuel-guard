import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOL_NAMES } from "@silvicom/shared";
import { openViewTool } from "./openAssistantView.js";
import { TOOLS, toolsFor } from "./askTools.js";

/** The model's tool definitions and the access contract name the same tools (F21 R5). */
describe("askTools", () => {
  it("every definition has an access rule and every access rule has a definition", () => {
    // `open_view` is built per caller from their pages (Step 5), so it is not in the static list.
    expect([...TOOLS.map((t) => t.name), openViewTool(["fuel_problems"]).name].sort()).toEqual([...ASSISTANT_TOOL_NAMES].sort());
  });
  it("toolsFor gives exactly the allowed tools, in the contract's order", () => {
    expect(toolsFor(["fleet_roster", "fuel_report"]).map((t) => t.name)).toEqual(["fuel_report", "fleet_roster"]);
    expect(toolsFor([])).toEqual([]);
  });
  it("open_view is offered only with pages to open, and lists only the caller's (F21 Step 5)", () => {
    expect(toolsFor(["fuel_report", "open_view"]).map((t) => t.name)).toEqual(["fuel_report"]);
    const tool = toolsFor(["open_view"], ["fuel_problems"])[0]!;
    expect(tool.name).toBe("open_view");
    expect((tool.input_schema.properties as { view: { enum: string[] } }).view.enum).toEqual(["fuel_problems"]);
  });
});
