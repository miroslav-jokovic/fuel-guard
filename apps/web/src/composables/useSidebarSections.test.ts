import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarSections } from "@/composables/useSidebarSections";

/**
 * Sidebar section state (phase 6).
 *
 * The rule worth pinning is the override: the section holding the current route stays open no matter
 * what was stored. Without it a deep link, a post-sign-in redirect or a notification can land on a
 * page whose own section is collapsed — the nav would be pointing away from where you are, silently,
 * and only for the person whose stored preference happened to include that section.
 *
 * This suite installs its own storage: the repo's jsdom has none at all (`localStorage` is undefined
 * bare, on `window` and on `globalThis`), so the no-storage path is what CI actually runs.
 */
function installStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as Storage,
  });
}

describe("useSidebarSections", () => {
  beforeEach(() => {
    installStorage();
    // Reset module state by collapsing then expanding nothing — the set lives at module scope.
    const { isOpen, toggle } = useSidebarSections(() => null);
    for (const label of ["Fuel", "Dispatch", "Safety"]) if (!isOpen(label)) toggle(label);
  });

  it("starts with every section open, which is exactly the old behaviour", () => {
    const { isOpen } = useSidebarSections(() => null);
    expect(isOpen("Fuel")).toBe(true);
    expect(isOpen("Dispatch")).toBe(true);
  });

  it("closes a section on the FIRST click", () => {
    // The bug this pins: storing OPEN sections meant the set started empty while the sidebar
    // started expanded, so the first click added the section to "open" and it stayed open. Storing
    // the closed ones makes the empty set mean what the UI already shows.
    const { isOpen, toggle } = useSidebarSections(() => null);
    toggle("Fuel");
    expect(isOpen("Fuel")).toBe(false);
  });

  it("reopens on a second click", () => {
    const { isOpen, toggle } = useSidebarSections(() => null);
    toggle("Fuel");
    toggle("Fuel");
    expect(isOpen("Fuel")).toBe(true);
  });

  it("leaves other sections alone", () => {
    const { isOpen, toggle } = useSidebarSections(() => null);
    toggle("Fuel");
    expect(isOpen("Dispatch")).toBe(true);
  });

  it("keeps the section holding the current route open, whatever was stored", () => {
    const collapseAll = useSidebarSections(() => null);
    collapseAll.toggle("Safety");
    expect(collapseAll.isOpen("Safety")).toBe(false);

    // Same stored state, but now the user is standing inside Safety.
    const onSafetyPage = useSidebarSections(() => "Safety");
    expect(onSafetyPage.isOpen("Safety")).toBe(true);
    // …and that override does not leak to its neighbours.
    onSafetyPage.toggle("Fuel");
    expect(onSafetyPage.isOpen("Fuel")).toBe(false);
  });

  it("remembers the choice across a fresh caller", () => {
    useSidebarSections(() => null).toggle("Dispatch");
    expect(useSidebarSections(() => null).isOpen("Dispatch")).toBe(false);
    expect(JSON.parse(localStorage.getItem("fg.sidebar-collapsed")!)).toContain("Dispatch");
  });

  it("still toggles when storage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    const { isOpen, toggle } = useSidebarSections(() => null);
    expect(() => toggle("Fleet")).not.toThrow();
    expect(isOpen("Fleet")).toBe(false);
    installStorage();
  });
});
