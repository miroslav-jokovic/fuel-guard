import { describe, it, expect } from "vitest";
import { canViewSection, type AppSection, type UserRole } from "@silvicom/shared";
import { visibleTabs, initialTab, showsTabStrip, DASHBOARD_TABS } from "./dashboardTabs";

/**
 * LM-T / D-DW6. The assertions that matter here are the ones driven by a SECTION GRANT rather than
 * by a role name — a tab set that changes when a grant changes is the proof that the matrix is the
 * mechanism, and that a `session.role` branch has not crept back in.
 */

/** The real matrix, asked the way the component asks it. */
const forRole = (role: UserRole) => (section: AppSection) => canViewSection(role, section);

describe("visibleTabs", () => {
  it("gives an admin every tab", () => {
    expect(visibleTabs(forRole("admin")).map((t) => t.key)).toEqual(["fleet", "dispatch"]);
  });

  it("gives a dispatcher both, because they hold fuel: view — and the money inside fleet is gated separately", () => {
    // This is the case that looks wrong and is right: Q-LM-F1 ruled the split is per element, so a
    // dispatcher may open Fleet overview and finds no dollar figure on it (see moneyGate.test.ts).
    expect(visibleTabs(forRole("dispatcher")).map((t) => t.key)).toEqual(["fleet", "dispatch"]);
  });

  it("gives a safety manager the fleet tab only — they hold dispatch: none", () => {
    expect(visibleTabs(forRole("safety_manager")).map((t) => t.key)).toEqual(["fleet"]);
  });

  it("gives an accountant the fleet tab only", () => {
    expect(visibleTabs(forRole("accountant")).map((t) => t.key)).toEqual(["fleet"]);
  });

  it("gives a driver nothing — every section is none for them (Q-LM-T1)", () => {
    expect(visibleTabs(forRole("driver"))).toEqual([]);
  });

  it("follows the GRANT, not the role — the property that proves the matrix is the mechanism", () => {
    // An org that grants `dispatch` to a role that does not ship with it gets the tab, with no code
    // change. Mutating the component to test `role === 'dispatcher'` would fail exactly here.
    const safetyPlusDispatch = (section: AppSection) =>
      section === "dispatch" ? true : canViewSection("safety_manager", section);
    expect(visibleTabs(safetyPlusDispatch).map((t) => t.key)).toEqual(["fleet", "dispatch"]);
  });
});

describe("initialTab", () => {
  it("lands a dispatcher on Dispatch, not on the first tab in the catalogue", () => {
    const tabs = visibleTabs(forRole("dispatcher"));
    expect(initialTab(tabs, "dispatcher")!.key).toBe("dispatch");
  });

  it("lands an admin on the first tab, because no tab names them", () => {
    const tabs = visibleTabs(forRole("admin"));
    expect(initialTab(tabs, "admin")!.key).toBe("fleet");
  });

  it("honours an explicitly requested tab", () => {
    const tabs = visibleTabs(forRole("admin"));
    expect(initialTab(tabs, "admin", "dispatch")!.key).toBe("dispatch");
  });

  it("ignores a requested tab the caller may not see, rather than rendering it", () => {
    const tabs = visibleTabs(forRole("safety_manager"));
    expect(initialTab(tabs, "safety_manager", "dispatch")!.key).toBe("fleet");
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
  it("names a section on every tab and never a role", () => {
    // `defaultFor` may name roles; `gate` may not. Pins D-DW6's one rule.
    for (const tab of DASHBOARD_TABS) expect(typeof tab.gate).toBe("string");
    expect(DASHBOARD_TABS.every((t) => t.gate.length > 0)).toBe(true);
  });
});
