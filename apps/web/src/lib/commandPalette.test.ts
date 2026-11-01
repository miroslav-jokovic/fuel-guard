import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";
import { buildNavGroups } from "./nav";
import { paletteEntries, scoreEntry, searchPalette } from "./commandPalette";
import { visibleSettingsScreens } from "./settingsCards";

/** Every module on, so a screen is in or out for its PERMISSION, not because the org lacks a module. */
const allModules = new Set(MODULE_KEYS) as unknown as ModuleSet;

/**
 * The ⌘K palette's list and matching (SIDEBAR-REDESIGN-PLAN.md D-SB1). The first block is the
 * permission property — the palette offers exactly what the sidebar and the Settings page offer,
 * and nothing else — because a search box that lists pages you cannot open is worse than none.
 */
const entriesFor = (role: "admin" | "dispatcher") =>
  paletteEntries(buildNavGroups(role, allModules), visibleSettingsScreens(role, null, null));

describe("what the palette lists", () => {
  it("is the caller's sidebar plus the Settings screens their Settings page shows, once each", () => {
    const admin = entriesFor("admin");
    const paths = admin.map((e) => e.to);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/loads");
    expect(paths).toContain("/settings/efs-soap");
    // Users is in the sidebar's footer AND a Settings card; it is listed once.
    expect(paths.filter((p) => p === "/settings/users")).toHaveLength(1);
  });

  it("never lists a page the caller's sidebar and Settings page would not", () => {
    const dispatcher = entriesFor("dispatcher").map((e) => e.to);
    expect(dispatcher).not.toContain("/settings/efs-soap");
    expect(dispatcher).not.toContain("/fleet-report");
    expect(dispatcher).not.toContain("/settings/users");
  });

  it("labels each entry with where it lives", () => {
    const admin = entriesFor("admin");
    expect(admin.find((e) => e.to === "/loads")?.section).toBe("Dispatch");
    expect(admin.find((e) => e.to === "/settings/efs-soap")?.section).toBe("Settings");
    expect(admin.find((e) => e.to === "/")?.section).toBeNull();
  });
});

describe("matching", () => {
  const admin = entriesFor("admin");
  const names = (q: string) => searchPalette(admin, q).map((e) => e.name);

  it("puts a page whose name starts with the query first", () => {
    expect(names("fuel c").slice(0, 2).sort()).toEqual(["Fuel cards", "Fuel costs"]);
  });

  it("finds a word anywhere in the name", () => {
    expect(names("cards")).toContain("Fuel cards");
    expect(names("card control")[0]).toBe("Card control");
  });

  it("needs every typed word to match, so two words narrow rather than widen", () => {
    expect(names("pilot inv")).toEqual(["Pilot invoices"]);
  });

  it("matches the section, ranked below name matches", () => {
    const safety = names("safety");
    expect(safety).toContain("Roadside inspections");
    expect(scoreEntry({ key: "x", name: "Roadside inspections", to: "/r", icon: admin[0]!.icon, section: "Safety" }, "safety")).toBe(3);
  });

  it("ignores case and accents", () => {
    expect(names("IFTA")).toEqual(names("ifta"));
    expect(names("ífta")).toEqual(names("ifta"));
  });

  it("returns nothing for nonsense, and everything in sidebar order for an empty query", () => {
    expect(names("zzzq")).toEqual([]);
    expect(searchPalette(admin, "").map((e) => e.to)).toEqual(admin.map((e) => e.to));
  });
});
