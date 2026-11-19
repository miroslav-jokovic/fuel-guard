import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { SURFACES } from "@silvicom/shared";
import { adsWorkspaceTabs } from "./adsWorkspace";

/**
 * The Ads workspace's tabs (V6; Q-APX18 (a)): the catalogue says which, the person's access says which of them they
 * see. Settings is its own grant, and the real fleet turned it on for recruiters on 2026-11-05 — so it is the tab
 * whose visibility has to follow the org's answer rather than the role.
 */
const access = vi.hoisted(() => ({ role: "recruiter" as string, surfaces: {} as Record<string, boolean> }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ isAuthenticated: true, role: access.role, sections: null, surfaces: access.surfaces }),
}));
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => null) }) };
});
import AdsTabs from "./AdsTabs.vue";

const PATHS = ["/ads", "/ads/campaigns", "/ads/studio", "/ads/automation", "/ads/settings"];

async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: PATHS.map((p) => ({ path: p, component: { template: "<div />" } })) });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(AdsTabs, { global: { plugins: [router] } });
  return { wrapper, router };
}
const labels = (w: Awaited<ReturnType<typeof mountAt>>["wrapper"]) => w.findAll('[role="tab"]').map((t) => t.text());

beforeEach(() => {
  access.role = "recruiter";
  access.surfaces = {};
});

describe("adsWorkspaceTabs", () => {
  it("is the catalogue's: the home, its children in catalogue order, then Settings", () => {
    expect(adsWorkspaceTabs(SURFACES).map((t) => [t.path, t.label])).toEqual([
      ["/ads", "Overview"], ["/ads/campaigns", "Campaigns"], ["/ads/studio", "Creative studio"], ["/ads/automation", "Automation"], ["/ads/settings", "Settings"],
    ]);
  });
});

describe("AdsTabs", () => {
  it("an admin sees all five", async () => {
    access.role = "admin";
    expect(labels((await mountAt("/ads")).wrapper)).toEqual(["Overview", "Campaigns", "Creative studio", "Automation", "Settings"]);
  });

  it("a recruiter sees Settings only where the org turned that screen on for them", async () => {
    expect(labels((await mountAt("/ads")).wrapper)).not.toContain("Settings");
    access.surfaces = { "admin.recruiting.ads": true };
    expect(labels((await mountAt("/ads")).wrapper)).toContain("Settings");
  });

  it("marks the tab of the page you are on, and a press navigates", async () => {
    access.role = "admin";
    const { wrapper, router } = await mountAt("/ads/studio");
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toBe("Creative studio");
    await wrapper.findAll('[role="tab"]').find((t) => t.text() === "Automation")!.trigger("click");
    await router.isReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.path).toBe("/ads/automation");
  });
});
