import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";
import { buildNavGroups } from "./nav";
import { MAX_PINNED, MAX_RECENT, currentItemKey, pushHistory, recentItems, resolveKeys, togglePin } from "./sidebarShortcuts";

/** Every module on, so a screen is in or out for its PERMISSION, not because the org lacks a module. */
const allModules = new Set(MODULE_KEYS) as unknown as ModuleSet;

/**
 * Pinned and Recent (SIDEBAR-REDESIGN-PLAN.md D-SB2). The property that matters most is the first
 * one: a pin is a POINTER into the caller's own sidebar, so it can never offer a page the sidebar
 * would not — which is the whole reason the stored thing is a key and not an item.
 */
const admin = buildNavGroups("admin", allModules);
const dispatcher = buildNavGroups("dispatcher", allModules);

describe("resolveKeys", () => {
  it("returns the caller's own items, in stored order", () => {
    expect(resolveKeys(admin, ["fleet.drivers", "dispatch.loads"]).map((i) => i.name)).toEqual(["Drivers", "Loads"]);
  });

  it("drops a pinned page the caller can no longer reach, rather than offering it", () => {
    // A dispatcher has no accounting section: a pin on the fleet report (say, from before a role
    // change) must not become a link the guard then refuses.
    expect(resolveKeys(admin, ["finance.fleet-report"])).toHaveLength(1);
    expect(resolveKeys(dispatcher, ["finance.fleet-report"])).toHaveLength(0);
  });

  it("ignores keys that are not surfaces at all", () => {
    expect(resolveKeys(admin, ["nope", "dispatch.loads"]).map((i) => i.key)).toEqual(["dispatch.loads"]);
  });
});

describe("togglePin", () => {
  it("adds, then removes", () => {
    expect(togglePin([], "a")).toEqual(["a"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });

  it(`refuses a pin past ${MAX_PINNED} instead of silently dropping one the person chose`, () => {
    const full = Array.from({ length: MAX_PINNED }, (_, i) => `k${i}`);
    expect(togglePin(full, "new")).toEqual(full);
    // …but unpinning still works when full.
    expect(togglePin(full, "k0")).toHaveLength(MAX_PINNED - 1);
  });
});

describe("recent", () => {
  it("moves a revisited page to the front without repeating it", () => {
    expect(pushHistory(["b", "a"], "a")).toEqual(["a", "b"]);
  });

  it("keeps a bounded history", () => {
    let h: string[] = [];
    for (let i = 0; i < 50; i++) h = pushHistory(h, `k${i}`);
    expect(h.length).toBeLessThan(50);
    expect(h[0]).toBe("k49");
  });

  it(`shows at most ${MAX_RECENT}, skipping the page you are on and anything already pinned`, () => {
    const history = ["dispatch.loads", "fleet.drivers", "fuel.log", "fleet.vehicles", "fuel.ifta"];
    const shown = recentItems(admin, history, ["fleet.drivers"], "dispatch.loads").map((i) => i.key);
    expect(shown).toEqual(["fuel.log", "fleet.vehicles", "fuel.ifta"]);
  });
});

describe("currentItemKey", () => {
  it("finds the item the shell's own isCurrent marks", () => {
    expect(currentItemKey(admin, (to) => to === "/loads")).toBe("dispatch.loads");
    expect(currentItemKey(admin, () => false)).toBeNull();
  });
});
