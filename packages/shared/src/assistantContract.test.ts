import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { resolveSectionAccess, rolesThatCanView } from "./auth.js";
import { MODULE_KEYS, type ModuleSet } from "./entitlements.js";
import {
  ASSISTANT_TOOL_ACCESS,
  ASSISTANT_TOOL_PAGE,
  assistantAnswerPages,
  ASSISTANT_TOOL_MODULES,
  ASSISTANT_TOOL_NAMES,
  assistantToolsFor,
  callerMayUseTool,
  NEVER_EXPOSED_FIELDS,
  stripNeverExposed,
  type ToolRequirement,
} from "./assistantContract.js";
import { SURFACES } from "./surfaceCatalogue.js";

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

  it("names the owner's facts: admin has every tool; a driver has none; a recruiter has the driver files and the applicants board; a technician the shop's two", () => {
    expect(assistantToolsFor("admin", null, ALL_MODULES)).toEqual(ASSISTANT_TOOL_NAMES);
    expect(assistantToolsFor("driver", null, ALL_MODULES)).toEqual([]);
    // R6b: the matrix lets a recruiter VIEW the roster, so the Drivers page's file tool is theirs.
    // …and the Applicants board's queues, theirs by `recruitment`.
    expect(assistantToolsFor("recruiter", null, ALL_MODULES)).toEqual(["driver_file_expirations", "recruiting_counts"]);
    // R6b: the technician's first tool is the truck page's repair bills, because the matrix lets them open it.
    expect(assistantToolsFor("technician", null, ALL_MODULES)).toEqual(["annual_inspections_due", "maintenance_cost"]);
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

  it("loads_by_truck is gated as the Loads page is: Dispatch bought, then dispatch view", () => {
    expect(ASSISTANT_TOOL_ACCESS.loads_by_truck).toEqual([{ module: "dispatch" }, { section: "dispatch", level: "view" }]);
    expect(callerMayUseTool("dispatcher", null, ALL_MODULES, "loads_by_truck")).toBe(true);
    expect(callerMayUseTool("dispatcher", null, NO_MODULES, "loads_by_truck")).toBe(false);
    expect(callerMayUseTool("recruiter", null, ALL_MODULES, "loads_by_truck")).toBe(false);
    expect(callerMayUseTool("dispatcher", { dispatch: "none" }, ALL_MODULES, "loads_by_truck")).toBe(false);
  });

  it("ifta_report is gated as the IFTA ledger is: fuel view, no module", () => {
    expect(ASSISTANT_TOOL_ACCESS.ifta_report).toEqual([{ section: "fuel", level: "view" }]);
    expect(callerMayUseTool("accountant", null, NO_MODULES, "ifta_report")).toBe(true);
    expect(callerMayUseTool("recruiter", null, ALL_MODULES, "ifta_report")).toBe(false);
    expect(callerMayUseTool("accountant", { fuel: "none" }, ALL_MODULES, "ifta_report")).toBe(false);
  });

  it("maintenance_cost is gated as the truck page's repair bills are: maintenance view, no module", () => {
    expect(ASSISTANT_TOOL_ACCESS.maintenance_cost).toEqual([{ section: "maintenance", level: "view" }]);
    expect(callerMayUseTool("technician", null, NO_MODULES, "maintenance_cost")).toBe(rolesThatCanView("maintenance").includes("technician"));
    expect(callerMayUseTool("recruiter", null, ALL_MODULES, "maintenance_cost")).toBe(false);
    expect(callerMayUseTool("admin", { maintenance: "none" }, ALL_MODULES, "maintenance_cost")).toBe(true);
  });

  it("card_holds is gated as the Fuel cards page is: fuel view, no module", () => {
    expect(ASSISTANT_TOOL_ACCESS.card_holds).toEqual([{ section: "fuel", level: "view" }]);
    expect(callerMayUseTool("dispatcher", null, NO_MODULES, "card_holds")).toBe(rolesThatCanView("fuel").includes("dispatcher"));
    expect(callerMayUseTool("recruiter", null, ALL_MODULES, "card_holds")).toBe(false);
  });

  it("the expiry tools are gated as their pages are: the Drivers page (roster) and the Shop worklist (maintenance)", () => {
    expect(ASSISTANT_TOOL_ACCESS.driver_file_expirations).toEqual([{ section: "roster", level: "view" }]);
    expect(ASSISTANT_TOOL_ACCESS.annual_inspections_due).toEqual([{ section: "maintenance", level: "view" }]);
    expect(callerMayUseTool("safety_manager", null, NO_MODULES, "driver_file_expirations")).toBe(true);
    expect(callerMayUseTool("safety_manager", { roster: "none" }, NO_MODULES, "driver_file_expirations")).toBe(false);
    expect(callerMayUseTool("technician", null, NO_MODULES, "annual_inspections_due")).toBe(rolesThatCanView("maintenance").includes("technician"));
  });

  it("recruiting_counts is gated as the Applicants board is: recruitment view", () => {
    expect(ASSISTANT_TOOL_ACCESS.recruiting_counts).toEqual([{ section: "recruitment", level: "view" }]);
    expect(callerMayUseTool("recruiter", null, NO_MODULES, "recruiting_counts")).toBe(true);
    expect(callerMayUseTool("recruiter", { recruitment: "none" }, NO_MODULES, "recruiting_counts")).toBe(false);
    expect(callerMayUseTool("technician", null, ALL_MODULES, "recruiting_counts")).toBe(rolesThatCanView("recruitment").includes("technician"));
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

describe("ASSISTANT_TOOL_PAGE — the page an answer links to (F21 R4a)", () => {
  it("every page a tool names is a real surface, gated by one of the tool's own sections", () => {
    for (const [tool, key] of Object.entries(ASSISTANT_TOOL_PAGE)) {
      if (key === null) continue;
      const surface = SURFACES.find((s) => s.key === key);
      expect(surface, `${tool} names ${key}`).toBeDefined();
      const sections = reqs(tool as keyof typeof ASSISTANT_TOOL_ACCESS).flatMap((r) => ("section" in r ? [r.section] : []));
      // The Dashboard (the live map's home) is open to everyone; every other page is a section's.
      if (surface!.gate.kind === "always") continue;
      expect(surface!.gate.kind, `${tool} -> ${key}`).toBe("section");
      expect(sections, `${tool} -> ${key}`).toContain((surface!.gate as { section: string }).section);
    }
  });

  // Q-AI12 (owner 2026-11-11): a page that asks MORE than its own report route hides a link to an answer
  // the person was entitled to — Fuel costs was `manage("fuel")` over a `view` route until this ruling.
  it("asks no more than the tool: a page's section level is one the tool's own requirement on it grants", () => {
    for (const [tool, key] of Object.entries(ASSISTANT_TOOL_PAGE)) {
      if (key === null) continue;
      const gate = SURFACES.find((s) => s.key === key)!.gate;
      if (gate.kind !== "section") continue;
      const asks = reqs(tool as keyof typeof ASSISTANT_TOOL_ACCESS).find((r) => "section" in r && r.section === gate.section);
      if (gate.level === "manage") expect(asks && "level" in asks ? asks.level : null, `${tool} -> ${key}`).toBe("manage");
    }
    expect(SURFACES.find((s) => s.key === "fuel.spend")!.gate).toEqual({ kind: "section", section: "fuel", level: "view" });
  });

  it("names a page only for the tools built on a page's own read", () => {
    expect(ASSISTANT_TOOL_PAGE.fuel_report).toBe("fuel.spend");
    expect(ASSISTANT_TOOL_PAGE.finance_report).toBe("finance.fleet-report");
    expect(ASSISTANT_TOOL_PAGE.fleet_summary).toBeNull();
    expect(ASSISTANT_TOOL_PAGE.fuel_ranking).toBeNull();
  });

  it("an answer's pages: each successful tool's, once, in call order", () => {
    expect(
      assistantAnswerPages([
        { name: "finance_report" },
        { name: "fuel_ranking" },
        { name: "idle_report", error: "timeout" },
        { name: "income_statement" },
        { name: "fuel_report" },
        { name: "not_a_tool" },
      ]),
    ).toEqual(["finance.fleet-report", "fuel.spend"]);
  });
});
