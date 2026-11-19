import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, type Ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AdsLeadCostView } from "@silvicom/shared";

/** V7d's card: the API's figures as given; no spend is said as such, never $0; the days are the URL's. */
const state = vi.hoisted(() => ({ data: undefined as unknown, ranges: [] as Array<Ref<{ from: string; to: string }>> }));
vi.mock("./useAdsOverview", () => ({
  useAdsLeadCost: (range: Ref<{ from: string; to: string }>) => {
    state.ranges.push(range);
    return { isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(null), refetch: () => {} };
  },
}));
import AdsLeadCostCard from "./AdsLeadCostCard.vue";

const row = (key: string, label: string, over: Partial<AdsLeadCostView["total"]> = {}) => ({
  key, label, leads: 0, qualified: 0, hired: 0, spend_cents: null, cost_per_qualified_cents: null, cost_per_hire_cents: null, ...over,
});
const VIEW: AdsLeadCostView = {
  from: "2026-11-01", to: "2026-11-19", zone: "America/Chicago", currency: "USD", checked_at: "2026-11-19T18:00:00Z",
  by_source: [
    row("meta", "Meta ad", { leads: 12, qualified: 4, hired: 1, spend_cents: 60_000, cost_per_qualified_cents: 15_000, cost_per_hire_cents: 60_000 }),
    row("tenstreet", "Tenstreet", { leads: 3, qualified: 1 }),
  ],
  by_angle: [row("pay_first+cab_pov", "Pay first, from the cab", { leads: 8, qualified: 0, spend_cents: 40_000 })],
  total: row("all", "All sources", { leads: 15, qualified: 5, hired: 1, spend_cents: 60_000 }),
  ad_spend_unattributed_cents: 2_500,
};

async function render(at = "/ads") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/ads", component: { template: "<div />" } }] });
  await router.push(at);
  await router.isReady();
  const w = mount(AdsLeadCostCard, { global: { plugins: [router], stubs: { DateRangeFilter: { props: ["from", "to"], template: "<span data-test='range'>{{ from }}–{{ to }}</span>" } } } });
  await w.vm.$nextTick();
  return { w, router };
}

beforeEach(() => {
  state.data = VIEW;
  state.ranges = [];
});

describe("AdsLeadCostCard", () => {
  it("draws each source's counts and costs, and a source with no spend as such, never $0", async () => {
    const { w } = await render();
    const text = w.find('[data-test="by-source"]').text();
    for (const s of ["Meta ad", "12", "$600", "$150", "Tenstreet", "No spend recorded", "All sources"]) expect(text).toContain(s);
    expect(text).not.toContain("$0");
  });

  it("an angle with spend and no qualified lead says so instead of a cost", async () => {
    const { w } = await render();
    expect(w.find('[data-test="by-angle"]').text()).toContain("None qualified yet");
    expect(w.find('[data-test="by-angle"]').text()).toContain("No hire yet");
  });

  it("says when the angles add up to less than the source", async () => {
    const { w } = await render();
    expect(w.find('[data-test="unattributed"]').text()).toContain("$25");
    state.data = { ...VIEW, ad_spend_unattributed_cents: 0 };
    expect((await render()).w.find('[data-test="unattributed"]').exists()).toBe(false);
  });

  it("reads the days in the URL, and this month so far without them", async () => {
    await render("/ads?from=2026-10-01&to=2026-10-31");
    expect(state.ranges.at(-1)!.value).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    await render();
    const r = state.ranges.at(-1)!.value;
    expect(r.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(r.from.slice(0, 7)).toBe(r.to.slice(0, 7));
  });
});
