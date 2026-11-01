import { beforeEach, describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { resetSidebarSectionsForTest, useSidebarSections } from "@/composables/useSidebarSections";

/**
 * Sidebar section state (phase 6; default reversed by SIDEBAR-REDESIGN-PLAN.md D-SB3).
 *
 * Two rules are worth pinning. Sections start CLOSED except the one holding the current page — that
 * is the whole point of D-SB3, the change from a 2,000 px wall to a list of headers. And arriving in
 * a section you had closed reopens it: without that a deep link, a post-sign-in redirect or the ⌘K
 * palette can land on a page whose own section is shut, and the nav points away from where you are.
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
    resetSidebarSectionsForTest();
  });

  it("starts every section closed except the one holding the current page", () => {
    const { isOpen } = useSidebarSections(() => "dispatch");
    expect(isOpen("dispatch")).toBe(true);
    expect(isOpen("fuel")).toBe(false);
    expect(isOpen("safety")).toBe(false);
  });

  it("starts everything closed on a page that belongs to no section", () => {
    const { isOpen } = useSidebarSections(() => null);
    expect(isOpen("dispatch")).toBe(false);
    expect(isOpen("fuel")).toBe(false);
  });

  it("opens a closed section on the FIRST click, and closes it on the second", () => {
    const { isOpen, toggle } = useSidebarSections(() => null);
    toggle("fuel");
    expect(isOpen("fuel")).toBe(true);
    toggle("fuel");
    expect(isOpen("fuel")).toBe(false);
  });

  it("lets the reader close the section they are standing in", () => {
    // Phase 6 forced the current section open, so its header did nothing when clicked — a control
    // that ignores you. The reader just watched it close, so nothing is hidden from them.
    const { isOpen, toggle } = useSidebarSections(() => "dispatch");
    toggle("dispatch");
    expect(isOpen("dispatch")).toBe(false);
  });

  it("keeps a section the reader opened open after they leave it", () => {
    const here = ref<string | null>(null);
    const { isOpen, toggle } = useSidebarSections(() => here.value);
    toggle("fuel");
    here.value = "dispatch";
    expect(isOpen("fuel")).toBe(true);
  });

  it("reopens a section the reader had closed when they arrive in it", async () => {
    const here = ref<string | null>(null);
    const { isOpen, toggle } = useSidebarSections(() => here.value);
    toggle("safety");
    toggle("safety"); // an explicit "closed" is now stored for Safety
    expect(isOpen("safety")).toBe(false);
    here.value = "safety";
    await nextTick();
    expect(isOpen("safety")).toBe(true);
  });

  it("remembers the choice across a fresh caller, keyed by group key", () => {
    useSidebarSections(() => null).toggle("dispatch");
    resetSidebarSectionsForTest();
    expect(useSidebarSections(() => null).isOpen("dispatch")).toBe(true);
    expect(JSON.parse(localStorage.getItem("fg.sidebar-sections")!)).toEqual({ dispatch: true });
  });

  it("ignores the phase-6 storage, which held labels and meant the opposite", () => {
    localStorage.setItem("fg.sidebar-collapsed", JSON.stringify(["Fuel"]));
    resetSidebarSectionsForTest();
    expect(useSidebarSections(() => null).isOpen("fuel")).toBe(false);
    expect(useSidebarSections(() => null).isOpen("Fuel")).toBe(false);
  });

  it("still toggles when storage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    resetSidebarSectionsForTest();
    const { isOpen, toggle } = useSidebarSections(() => null);
    expect(() => toggle("fleet")).not.toThrow();
    expect(isOpen("fleet")).toBe(true);
    installStorage();
  });
});
