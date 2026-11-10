import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { resolveSectionAccess, rolesThatCanView } from "./auth.js";
import {
  ASSISTANT_TOOL_ACCESS,
  ASSISTANT_TOOL_NAMES,
  assistantToolsFor,
  callerMayUseTool,
  NEVER_EXPOSED_FIELDS,
  stripNeverExposed,
} from "./assistantContract.js";

/**
 * Which tools each person may use (F21 R5, D-AI1). The expectation for every role × tool is DERIVED
 * from the section matrix the same way the rule is, and then checked against named facts the owner
 * ruled — so a rule that drifted from the matrix fails, and so does a matrix change that would quietly
 * widen what a role can ask.
 */
describe("assistantToolsFor — every role, every tool, from the section matrix", () => {
  for (const role of USER_ROLES) {
    it(`${role}: exactly the tools whose every section the role can view`, () => {
      const want = ASSISTANT_TOOL_NAMES.filter(
        (t) => role !== "driver" && ASSISTANT_TOOL_ACCESS[t].every((r) => rolesThatCanView(r.section).includes(role)),
      );
      expect(assistantToolsFor(role, null)).toEqual(want);
    });
  }

  it("names the owner's facts: admin has every tool; a driver, a recruiter and a technician have none today", () => {
    expect(assistantToolsFor("admin", null)).toEqual(ASSISTANT_TOOL_NAMES);
    expect(assistantToolsFor("driver", null)).toEqual([]);
    expect(assistantToolsFor("recruiter", null)).toEqual([]);
    expect(assistantToolsFor("technician", null)).toEqual([]);
    // A dispatcher sees fuel (view) and roster/equipment (view) but not safety: no idling or driver scores.
    const dispatcher = assistantToolsFor("dispatcher", null);
    expect(dispatcher).toContain("fuel_report");
    expect(dispatcher).toContain("fleet_roster");
    expect(dispatcher).not.toContain("idling_summary");
    expect(dispatcher).not.toContain("driver_performance");
  });

  it("follows the org's overrides on the token: taking fuel away from a fleet manager takes the fuel tools with it", () => {
    const narrowed = assistantToolsFor("fleet_manager", { fuel: "none" });
    expect(narrowed.some((t) => ASSISTANT_TOOL_ACCESS[t].some((r) => r.section === "fuel"))).toBe(false);
    expect(narrowed).toContain("idling_summary");
    expect(resolveSectionAccess("fleet_manager", "fuel", { fuel: "none" })).toBe("none");
  });

  it("a tool needing two sections needs both", () => {
    expect(callerMayUseTool("safety_manager", { roster: "view", equipment: "none" }, "fleet_roster")).toBe(false);
    expect(callerMayUseTool("safety_manager", { roster: "view", equipment: "view" }, "fleet_roster")).toBe(true);
  });
});

describe("stripNeverExposed (D-AI7)", () => {
  it("removes every listed field at any depth, any case, and keeps the rest", () => {
    const out = stripNeverExposed({
      driver: { name: "Ana", SSN: "123-45-6789", date_of_birth: "1990-01-01", cdl_number: "X1", status: "active" },
      cards: [{ last4: "4417", card_number: "7083001234567890", PIN: "1234" }],
      gl: { account_number: "5100" },
      count: 3,
    });
    expect(out).toEqual({ driver: { name: "Ana", status: "active" }, cards: [{ last4: "4417" }], gl: { account_number: "5100" }, count: 3 });
  });

  it("does not touch its input", () => {
    const input = { ssn: "1", keep: [1, 2] };
    stripNeverExposed(input);
    expect(input).toEqual({ ssn: "1", keep: [1, 2] });
  });

  it("lists only lowercase keys, so the case-insensitive match can find each of them", () => {
    for (const f of NEVER_EXPOSED_FIELDS) expect(f).toBe(f.toLowerCase());
  });
});
