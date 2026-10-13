import { describe, it, expect } from "vitest";
import { surfaceGateAllows, type Gated, type SectionClaim, type UserRole } from "@silvicom/shared";
import { visibleTabs, initialTab, showsTabStrip, DASHBOARD_TABS } from "./dashboardTabs";

/**
 * LM-T / D-DW6. The assertions that matter here are the ones driven by a SECTION GRANT rather than
 * by a role name — a tab set that changes when a grant changes is the proof that the matrix is the
 * mechanism, and that a `session.role` branch has not crept back in.
 */

/** The real matrix, asked the way the page asks it — the surface gate's own evaluator. */
const forRole = (role: UserRole, sections: SectionClaim | null = null) => (tab: Gated) =>
  surfaceGateAllows(tab, role, sections);

describe("visibleTabs", () => {
  it("gives an admin every tab, Operations first", () => {
    expect(visibleTabs(forRole("admin")).map((t) => t.key)).toEqual(["ops", "fleet", "dispatch"]);
  });

  it("gives a fleet manager every tab", () => {
    expect(visibleTabs(forRole("fleet_manager")).map((t) => t.key)).toEqual(["ops", "fleet", "dispatch"]);
  });

  it("gives a dispatcher both, because they hold fuel: view — and the money inside fleet is gated separately", () => {
    // This is the case that looks wrong and is right: Q-LM-F1 ruled the split is per element, so a
    // dispatcher may open Fleet overview and finds no dollar figure on it (see moneyGate.test.ts).
    // They hold `equipment: view` and not manage, so Operations is not theirs (D-FM2).
    expect(visibleTabs(forRole("dispatcher")).map((t) => t.key)).toEqual(["fleet", "dispatch"]);
  });

  it("gives a safety manager the fleet tab only — they hold dispatch: none and equipment: view", () => {
    expect(visibleTabs(forRole("safety_manager")).map((t) => t.key)).toEqual(["fleet"]);
  });

  it("gives an accountant and an auditor no Operations tab — neither manages the fleet's record", () => {
    expect(visibleTabs(forRole("accountant")).map((t) => t.key)).toEqual(["fleet"]);
    expect(visibleTabs(forRole("auditor")).map((t) => t.key)).toEqual(["fleet", "dispatch"]);
  });

  it("gives a driver nothing — every section is none for them (Q-LM-T1)", () => {
    expect(visibleTabs(forRole("driver"))).toEqual([]);
  });

  it("follows the GRANT, not the role — the property that proves the matrix is the mechanism", () => {
    // An org that grants `dispatch` to a role that does not ship with it gets the tab, with no code
    // change. Mutating the page to test `role === 'dispatcher'` would fail exactly here.
    expect(visibleTabs(forRole("safety_manager", { dispatch: "view" })).map((t) => t.key)).toEqual(["fleet", "dispatch"]);
  });

  it("gives Operations to whoever is granted equipment: manage, and only at manage", () => {
    // D-FM2: the tab gate is `manage("equipment")`. A dispatcher an org trusts with the fleet's record
    // gets the tab; the same dispatcher at `view` — their default — does not.
    expect(visibleTabs(forRole("dispatcher", { equipment: "manage" })).map((t) => t.key)).toContain("ops");
    expect(visibleTabs(forRole("dispatcher", { equipment: "view" })).map((t) => t.key)).not.toContain("ops");
  });
});

describe("initialTab", () => {
  it("lands a dispatcher on Dispatch, not on the first tab in the catalogue", () => {
    const tabs = visibleTabs(forRole("dispatcher"));
    expect(initialTab(tabs, "dispatcher")!.key).toBe("dispatch");
  });

  it("lands a fleet manager on Operations, with Fleet overview and Dispatch one tab away", () => {
    // FLEET-MANAGER-HOME-PLAN D-FM3 (owner, 2026-10-12): this replaced the Dispatch default set earlier that day.
    const tabs = visibleTabs(forRole("fleet_manager"));
    expect(initialTab(tabs, "fleet_manager")!.key).toBe("ops");
    // By NAME, not by being first: Q-FM2 put Operations first, and reversing that ruling must not
    // quietly move the fleet manager's landing tab with it.
    expect(initialTab([...tabs].reverse(), "fleet_manager")!.key).toBe("ops");
  });

  it("lands an admin on the first tab, because no tab names them", () => {
    const tabs = visibleTabs(forRole("admin"));
    expect(initialTab(tabs, "admin")!.key).toBe("ops");
  });

  it("honours an explicitly requested tab", () => {
    const tabs = visibleTabs(forRole("fleet_manager"));
    expect(initialTab(tabs, "fleet_manager", "dispatch")!.key).toBe("dispatch");
  });

  it("ignores a requested tab the caller may not see, rather than rendering it", () => {
    const tabs = visibleTabs(forRole("safety_manager"));
    expect(initialTab(tabs, "safety_manager", "dispatch")!.key).toBe("fleet");
    expect(initialTab(visibleTabs(forRole("dispatcher")), "dispatcher", "ops")!.key).toBe("dispatch");
  });

  it("returns null when the caller may see nothing", () => {
    expect(initialTab([], "driver")).toBeNull();
  });
});

describe("showsTabStrip", () => {
  it("shows chrome only when there is a choice to make", () => {
    expect(showsTabStrip(visibleTabs(forRole("admin")))).toBe(true);
    expect(showsTabStrip(visibleTabs(forRole("safety_manager")))).toBe(false);
    expect(showsTabStrip([])).toBe(false);
  });
});

describe("the catalogue itself", () => {
  it("gates every tab on a section and never on a role", () => {
    // `defaultFor` may name roles; `gate` may not. Pins D-DW6's one rule.
    for (const tab of DASHBOARD_TABS) expect(tab.gate.kind).toBe("section");
  });
});
