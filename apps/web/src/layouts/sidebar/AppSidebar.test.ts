import { beforeEach, describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";
import { buildNavGroups } from "@/lib/nav";
import { resetSidebarSectionsForTest } from "@/composables/useSidebarSections";
import { resetSidebarShortcutsForTest } from "@/composables/useSidebarShortcuts";
import AppSidebar from "./AppSidebar.vue";

/**
 * The redesigned sidebar as a reader meets it (SIDEBAR-REDESIGN-PLAN.md D-SB1..D-SB4, D-SB6): the
 * search field first, sections closed unless they hold this page, a pin that puts a page at the top,
 * and Settings in the fixed footer rather than in the scrolling list.
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

const groups = buildNavGroups("admin", new Set(MODULE_KEYS) as unknown as ModuleSet);
const here = "/loads";

async function mountSidebar(props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div/>" } }] });
  await router.push(here);
  const w = mount(AppSidebar, {
    props: { groups, isCurrent: (to: string) => to === here, email: "a@b.test", name: "Ann", role: "admin", ...props },
    global: { plugins: [router], stubs: { SidebarProfileMenu: true, SidebarFlyoutSection: true, AppWordmark: true, AppLogo: true } },
  });
  await flushPromises();
  return w;
}

const sectionButton = (w: Awaited<ReturnType<typeof mountSidebar>>, label: string) =>
  w.findAll("button[aria-expanded]").find((b) => b.text().startsWith(label))!;

describe("AppSidebar", () => {
  beforeEach(() => {
    installStorage();
    resetSidebarSectionsForTest();
    resetSidebarShortcutsForTest();
  });

  it("opens only the section holding the current page", async () => {
    const w = await mountSidebar();
    expect(sectionButton(w, "Dispatch").attributes("aria-expanded")).toBe("true");
    expect(sectionButton(w, "Fuel").attributes("aria-expanded")).toBe("false");
    expect(sectionButton(w, "Safety").attributes("aria-expanded")).toBe("false");
  });

  it("puts Settings and Users in the footer, not in the scrolling list", async () => {
    const w = await mountSidebar();
    const primary = w.find("nav[aria-label='Primary navigation']");
    const footer = w.find("nav[aria-label='Administration']");
    expect(primary.find("a[href='/settings']").exists()).toBe(false);
    expect(footer.find("a[href='/settings']").exists()).toBe(true);
    expect(footer.find("a[href='/settings/users']").exists()).toBe(true);
    // …and there is no "Admin" section header for them.
    expect(w.findAll("button[aria-expanded]").some((b) => b.text().startsWith("Admin"))).toBe(false);
  });

  it("pins a page to the top and unpins it again", async () => {
    const w = await mountSidebar();
    expect(w.find("ul[aria-label='Pinned pages']").exists()).toBe(false);
    await w.find("button[aria-label='Pin Fuel log to the top']").trigger("click");
    const pinnedList = w.find("ul[aria-label='Pinned pages']");
    expect(pinnedList.find("a[href='/fuel-log']").exists()).toBe(true);
    await pinnedList.find("button[aria-label='Unpin Fuel log']").trigger("click");
    expect(w.find("ul[aria-label='Pinned pages']").exists()).toBe(false);
  });

  it("offers search first, and asks the shell to open it", async () => {
    const w = await mountSidebar();
    const search = w.findAll("button").find((b) => b.text().startsWith("Search"))!;
    await search.trigger("click");
    expect(w.emitted("openSearch")).toHaveLength(1);
  });

  it("puts the collapse control in the sidebar's own header", async () => {
    const w = await mountSidebar();
    await w.find("button[aria-label='Collapse sidebar']").trigger("click");
    expect(w.emitted("toggleCollapse")).toHaveLength(1);
    const rail = await mountSidebar({ collapsed: true });
    expect(rail.find("button[aria-label='Expand sidebar']").exists()).toBe(true);
  });

  it("has no collapse control in the phone drawer, which closes instead", async () => {
    const w = await mountSidebar({ drawer: true });
    expect(w.find("button[aria-label='Collapse sidebar']").exists()).toBe(false);
  });
});
