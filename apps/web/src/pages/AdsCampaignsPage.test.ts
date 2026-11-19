import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { ADS_SETTINGS_UNSET } from "@silvicom/shared";

/**
 * Ads › Campaigns, Assisted start (V5 part 3): with the mode at Assisted, every open opening with no campaign is listed,
 * and Start — or the Overview's `?start=` link — opens the create form with that opening chosen. Nothing is created
 * here; the form's own Start is the only door (its tests are `adsCampaign.test.ts`).
 */
const start = vi.hoisted(() => ({ mode: "manual" as "manual" | "assisted", manages: true, openings: [] as unknown[], campaigns: [] as unknown[] }));
vi.mock("@/features/ads/useAdsSettings", () => ({ useAdsSettings: () => ({ data: ref({ settings: { ...ADS_SETTINGS_UNSET, modes: { start_campaign: start.mode } } }) }) }));
vi.mock("@/features/ads/useAdsCampaigns", () => ({ useAdsCampaigns: () => ({ data: ref(start.campaigns), isLoading: ref(false), isError: ref(false), isFetching: ref(false) }) }));
vi.mock("@/features/recruitment/useLeads", () => ({ useOpenOpeningsQuery: () => ({ data: ref(start.openings) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "recruitment" && start.manages }) }));
import AdsCampaignsPage from "./AdsCampaignsPage.vue";

/** The create form, stubbed: what the page hands it is what this file checks. */
const CreateDrawer = defineComponent({ props: { open: Boolean, offered: { type: String, default: null } }, setup: (p) => () => h("div", { "data-test": "create", "data-open": String(p.open), "data-opening": p.offered ?? "" }) });

async function render(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/ads/campaigns", component: AdsCampaignsPage }] });
  await router.push({ path: "/ads/campaigns", query });
  await router.isReady();
  const w = mount(AdsCampaignsPage, { global: { plugins: [router], stubs: { PageHeader: true, AdsTabs: true, AdsCampaignDrawer: true, AdsCampaignCreateDrawer: CreateDrawer } } });
  await flushPromises();
  return { w, router };
}
const form = (w: Awaited<ReturnType<typeof render>>["w"]) => w.find('[data-test="create"]');

beforeEach(() => {
  start.mode = "assisted";
  start.manages = true;
  start.openings = [{ value: "op-1", label: "Dallas regional" }, { value: "op-2", label: "Joliet local" }];
  start.campaigns = [{ id: "k1", name: "Dallas", state: "live", state_changed_at: "2026-11-18T15:00:00Z", brief_source: "recruiting_opening", brief_ref: "op-1" }];
});

describe("AdsCampaignsPage — Assisted start (V5)", () => {
  it("lists the open openings with no campaign, and Start opens the form with that one chosen", async () => {
    const { w, router } = await render();
    expect(w.findAll('[data-test="awaiting-opening"]').map((r) => r.text())).toEqual([expect.stringContaining("Joliet local")]);
    expect(form(w).attributes("data-open")).toBe("false");
    await w.find('[data-test="start-op-2"]').trigger("click");
    await flushPromises();
    expect([form(w).attributes("data-open"), form(w).attributes("data-opening")]).toEqual(["true", "op-2"]);
    expect(router.currentRoute.value.query).toEqual({ start: "op-2" });
  });

  it("the Overview's ?start= link opens the form with that opening chosen", async () => {
    const { w } = await render({ start: "op-2" });
    expect([form(w).attributes("data-open"), form(w).attributes("data-opening")]).toEqual(["true", "op-2"]);
  });

  it("a ?start= naming no open opening chooses nothing and opens nothing", async () => {
    const { w } = await render({ start: "op-gone" });
    expect([form(w).attributes("data-open"), form(w).attributes("data-opening")]).toEqual(["false", ""]);
  });

  it("Manual, someone who cannot start a campaign, or a list the door may have cut off: nothing is listed", async () => {
    start.mode = "manual";
    expect((await render()).w.find('[data-test="awaiting-openings"]').exists()).toBe(false);
    start.mode = "assisted";
    start.manages = false;
    expect((await render()).w.find('[data-test="awaiting-openings"]').exists()).toBe(false);
    start.manages = true;
    start.campaigns = Array.from({ length: 200 }, (_, i) => ({ id: `k${i}`, name: "x", state: "live", state_changed_at: "2026-11-18T15:00:00Z", brief_source: "recruiting_opening", brief_ref: `x${i}` }));
    expect((await render()).w.find('[data-test="awaiting-openings"]').exists()).toBe(false);
  });
});
