import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { resolveSectionAccess, rolesThatCanView } from "./auth.js";
import { MODULE_KEYS, type ModuleSet } from "./entitlements.js";
import {
  ASSISTANT_TOOL_ACCESS,
  ASSISTANT_TOOL_MODULES,
  ASSISTANT_TOOL_NAMES,
  assistantToolsFor,
  callerMayUseTool,
  NEVER_EXPOSED_FIELDS,
  stripNeverExposed,
  type ToolRequirement,
} from "./assistantContract.js";

/** A carrier that bought everything, and one that bought nothing. */
const ALL_MODULES: ModuleSet = new Set(MODULE_KEYS);
const NO_MODULES: ModuleSet = new Set();
const reqs = (t: keyof typeof ASSISTANT_TOOL_ACCESS) => ASSISTANT_TOOL_ACCESS[t] as readonly ToolRequirement[];

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
        (t) => role !== "driver" && reqs(t).every((r) => "module" in r || rolesThatCanView(r.section).includes(role)),
      );
      expect(assistantToolsFor(role, null, ALL_MODULES)).toEqual(want);
    });
  }

  it("names the owner's facts: admin has every tool; a driver, a recruiter and a technician have none today", () => {
    expect(assistantToolsFor("admin", null, ALL_MODULES)).toEqual(ASSISTANT_TOOL_NAMES);
    expect(assistantToolsFor("driver", null, ALL_MODULES)).toEqual([]);
    expect(assistantToolsFor("recruiter", null, ALL_MODULES)).toEqual([]);
    expect(assistantToolsFor("technician", null, ALL_MODULES)).toEqual([]);
    // A dispatcher sees fuel (view) and roster/equipment (view) but not safety: no idling or driver scores.
    const dispatcher = assistantToolsFor("dispatcher", null, ALL_MODULES);
    expect(dispatcher).toContain("fuel_report");
    expect(dispatcher).toContain("fleet_roster");
    expect(dispatcher).not.toContain("idling_summary");
    expect(dispatcher).not.toContain("driver_performance");
  });

  it("finance follows `accounting` (Q-AI5): admin, accountant and the read-only auditor, nobody else", () => {
    // Q-AI5 was ruled on "the matrix gives accounting to admin and accountant only". The matrix also
    // gives the auditor VIEW of every section, the Fleet report page included, so the auditor's tools
    // follow the page (correction logged in F21-ask-ai/PLAN.md §6, 2026-11-10; Q-AI11). No role list.
    const FINANCE = ["finance_report", "income_statement"] as const;
    const reach = USER_ROLES.filter((role) => FINANCE.every((t) => assistantToolsFor(role, null, ALL_MODULES).includes(t)));
    expect(reach).toEqual(USER_ROLES.filter((r) => rolesThatCanView("accounting").includes(r)));
    expect([...reach].sort()).toEqual(["accountant", "admin", "auditor"]);
    for (const role of USER_ROLES) {
      if (!reach.includes(role)) expect(FINANCE.some((t) => assistantToolsFor(role, null, ALL_MODULES).includes(t))).toBe(false);
    }
    // An org that takes accounting away from its accountant takes the finance tools with it.
    expect(assistantToolsFor("accountant", { accounting: "none" }, ALL_MODULES)).not.toContain("finance_report");
  });

  it("a module-gated tool needs the carrier to have bought the module (R6b): Dispatch for fleet_now", () => {
    expect(ASSISTANT_TOOL_MODULES).toEqual(["dispatch"]);
    expect(assistantToolsFor("admin", null, ALL_MODULES)).toContain("fleet_now");
    expect(assistantToolsFor("admin", null, new Set(["dispatch"]))).toContain("fleet_now");
    // Without Dispatch, or with the modules never read (null), nobody gets it, admin included.
    expect(assistantToolsFor("admin", null, NO_MODULES)).not.toContain("fleet_now");
    expect(assistantToolsFor("admin", null, null)).not.toContain("fleet_now");
    expect(callerMayUseTool("dispatcher", null, NO_MODULES, "fleet_now")).toBe(false);
    // Bought, but the section still decides: a recruiter cannot view dispatch.
    expect(callerMayUseTool("recruiter", null, ALL_MODULES, "fleet_now")).toBe(false);
    // Tools whose pages carry no module gate are untouched by a carrier's modules.
    expect(assistantToolsFor("admin", null, NO_MODULES)).toEqual(ASSISTANT_TOOL_NAMES.filter((t) => !reqs(t).some((r) => "module" in r)));
  });

  it("follows the org's overrides on the token: taking fuel away from a fleet manager takes the fuel tools with it", () => {
    const narrowed = assistantToolsFor("fleet_manager", { fuel: "none" }, ALL_MODULES);
    expect(narrowed.some((t) => reqs(t).some((r) => "section" in r && r.section === "fuel"))).toBe(false);
    expect(narrowed).toContain("idling_summary");
    expect(resolveSectionAccess("fleet_manager", "fuel", { fuel: "none" })).toBe("none");
  });

  it("a tool needing two sections needs both", () => {
    expect(callerMayUseTool("safety_manager", { roster: "view", equipment: "none" }, ALL_MODULES, "fleet_roster")).toBe(false);
    expect(callerMayUseTool("safety_manager", { roster: "view", equipment: "view" }, ALL_MODULES, "fleet_roster")).toBe(true);
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
