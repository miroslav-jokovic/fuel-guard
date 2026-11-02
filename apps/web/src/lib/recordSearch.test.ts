import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";
import { buildNavGroups } from "./nav";
import { paletteEntries, type PaletteEntry } from "./commandPalette";
import { anyColumnIlike, detailOf, recordEntry, searchableKinds, searchPlaceholder } from "./recordSearch";

/**
 * Who may search which records from ⌘K (D-SB8). The permission block comes first, for the reason
 * the page palette's does: a result is a link, and a search that offers a record its reader cannot
 * open is worse than no search.
 */
const allModules = new Set(MODULE_KEYS) as unknown as ModuleSet;
const noDispatch = new Set(MODULE_KEYS.filter((m) => m !== "dispatch")) as unknown as ModuleSet;
const entriesFor = (role: "admin" | "dispatcher" | "safety_manager", modules = allModules): PaletteEntry[] =>
  paletteEntries(buildNavGroups(role, modules), []);
const everythingOpens = () => true;
const kindsOf = (entries: PaletteEntry[], opens: (to: unknown) => boolean = everythingOpens) =>
  searchableKinds(entries, opens as never).map((k) => k.kind);

describe("which kinds a caller may search", () => {
  it("offers all four to a caller whose sidebar lists all four pages", () => {
    expect(kindsOf(entriesFor("admin"))).toEqual(["truck", "trailer", "driver", "load"]);
  });

  it("offers no loads to an org without Dispatch — its API would refuse them", () => {
    expect(kindsOf(entriesFor("admin", noDispatch))).not.toContain("load");
  });

  it("offers no kind whose detail page the guard would turn away", () => {
    const opens = (to: unknown) => !String(to).startsWith("/drivers/");
    expect(kindsOf(entriesFor("admin"), opens)).toEqual(["truck", "trailer", "load"]);
  });

  it("follows the sidebar role by role, never a list of its own", () => {
    for (const role of ["admin", "dispatcher", "safety_manager"] as const) {
      const entries = entriesFor(role);
      const kinds = searchableKinds(entries, everythingOpens);
      for (const k of kinds) expect(entries.map((e) => e.to)).toContain(k.list);
    }
  });
});

describe("how a record reads", () => {
  const [truck] = searchableKinds(entriesFor("admin"), everythingOpens);

  it("links to its detail page and wears its list page's icon and name", () => {
    const vehicles = entriesFor("admin").find((e) => e.to === "/vehicles")!;
    const e = recordEntry(truck!, { id: "v1", name: "1042", detail: "2021 · Freightliner" });
    expect(e).toMatchObject({ to: "/vehicles/v1", name: "1042", section: vehicles.name, icon: vehicles.icon, detail: "2021 · Freightliner" });
    expect(e.key).toBe("record:truck:v1");
  });

  it("names in the placeholder only what can be found", () => {
    expect(searchPlaceholder([])).toBe("Go to a page…");
    expect(searchPlaceholder(searchableKinds(entriesFor("admin"), everythingOpens))).toBe(
      "Go to a page, truck, trailer, driver or load…",
    );
  });

  it("joins the parts of a detail that are present", () => {
    expect(detailOf(2021, null, " Cascadia ", "")).toBe("2021 · Cascadia");
    expect(detailOf(null, undefined)).toBeNull();
  });

  it("quotes every value of an .or() filter, so a dot in a unit number is not syntax", () => {
    expect(anyColumnIlike(["unit_number", "plate"], "%T-1.2%")).toBe('unit_number.ilike."%T-1.2%",plate.ilike."%T-1.2%"');
  });
});
