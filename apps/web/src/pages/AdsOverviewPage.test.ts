import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, ref, type Ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { ADS_SETTINGS_UNSET, type AdsOverviewView } from "@silvicom/shared";

/**
 * Ads › Overview (V6): draws the API's figures as given, the "Needs you" rows with where each leads, and the action
 * ledger addressed by its cursor in the URL (D-US12). A failed read is a failure on screen, never a month of $0.
 */
const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as unknown, positions: [] as unknown[], canOpenSettings: false }));
vi.mock("@/features/ads/useAdsOverview", () => ({
  useAdsOverview: (position: Ref<unknown>) => {
    state.positions.push(position);
    return { isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(state.error), refetch: () => {} };
  },
}));
// V5 part 3: the reads behind the Assisted-start rows — the carrier's mode, the open openings and the campaigns.
const start = vi.hoisted(() => ({ mode: "manual" as "manual" | "assisted", manages: true, openings: [] as unknown[], campaigns: [] as unknown[] }));
vi.mock("@/features/ads/useAdsSettings", () => ({ useAdsSettings: () => ({ data: ref({ settings: { ...ADS_SETTINGS_UNSET, modes: { start_campaign: start.mode } } }) }) }));
vi.mock("@/features/ads/useAdsCampaigns", () => ({ useAdsCampaigns: () => ({ data: ref(start.campaigns) }) }));
vi.mock("@/features/recruitment/useLeads", () => ({ useOpenOpeningsQuery: () => ({ data: ref(start.openings) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "recruitment" && start.manages }) }));
vi.mock("@/features/ads/useAdsTabs", () => ({ useAdsTabs: () => ({ tabs: computed(() => []), canOpenSettings: computed(() => state.canOpenSettings) }) }));
import AdsOverviewPage from "./AdsOverviewPage.vue";

const T = "2026-11-18T15:00:00.123456+00:00";
const VIEW: AdsOverviewView = {
  checked_at: T, month: "2026-11", kill_switch: { on: false, reason: null },
  totals: { running: 2, month_spend_cents: 9_000, month_leads: 4, month_cost_per_lead_cents: 2_250 },
  campaigns: [],
  needs_you: [
    { kind: "no_monthly_cap", tone: "warn", title: "No monthly cap for meta", detail: "Nothing launches on this platform.", campaign_id: null, connection_id: null, since: null },
    { kind: "ads_review", tone: "warn", title: "CDL-A Tulsa", detail: "2 ads ready for your review.", campaign_id: "k1", connection_id: null, since: T },
  ],
  ledger: {
    entries: [{ id: "a1", kind: "transition", status: "refused", actor_kind: "agent", actor_name: "Orchestrator", campaign_id: "k1", campaign_name: "CDL-A Tulsa", from_state: "review", event: "creatives_approved", cause: null, error_code: "actor_not_allowed", started_at: T, finished_at: T }],
    older: `${T}|0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d`, newer: null,
  },
};

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/ads", component: AdsOverviewPage }, { path: "/:rest(.*)", component: { template: "<div />" } }] });
  await router.push("/ads");
  await router.isReady();
  const wrapper = mount(AdsOverviewPage, { global: { plugins: [router], stubs: { PageHeader: true, AdsTabs: true } } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  state.data = VIEW;
  state.error = null;
  state.positions = [];
  state.canOpenSettings = false;
  start.mode = "manual";
  start.manages = true;
  start.openings = [{ value: "op-1", label: "Dallas regional" }, { value: "op-2", label: "Joliet local" }];
  start.campaigns = [{ brief_source: "recruiting_opening", brief_ref: "op-1", state: "live" }];
});

describe("AdsOverviewPage", () => {
  it("draws the month as the API gave it", async () => {
    const text = (await render()).wrapper.text();
    for (const s of ["Running", "2", "$90", "Leads this month", "4", "$22.50", "Recruitment › Leads"]) expect(text, s).toContain(s);
  });

  it("each waiting item says what is wrong; a campaign opens its drawer, Settings only for someone who may open it", async () => {
    const { wrapper } = await render();
    const items = wrapper.find('[data-test="needs-you"]');
    expect(items.text()).toContain("2 ads ready for your review.");
    const links = items.findAll("a").map((a) => a.attributes("href"));
    expect(links).toEqual(["/ads/campaigns?campaign=k1"]);
    state.canOpenSettings = true;
    expect((await render()).wrapper.find('[data-test="needs-you"]').findAll("a").map((a) => a.attributes("href"))).toEqual(["/ads/settings", "/ads/campaigns?campaign=k1"]);
  });

  it("a ledger row says where the move went and how it ended", async () => {
    const text = (await render()).wrapper.text();
    expect(text).toContain("Waiting for review → Approved");
    expect(text).toContain("Refused");
  });

  it("Older puts the page's own cursor in the URL, and the read follows it", async () => {
    const { wrapper, router } = await render();
    await wrapper.findAll("button").find((b) => b.text() === "Older")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ before: VIEW.ledger.older });
    expect((state.positions.at(-1) as Ref<unknown>).value).toEqual({ before: VIEW.ledger.older });
  });

  it("a failed read is a failure on screen, never a month of nothing", async () => {
    state.data = undefined;
    state.error = new Error("down");
    const text = (await render()).wrapper.text();
    expect(text).toContain("Could not load the ads overview.");
    expect(text).not.toContain("$0");
  });

  it("Assisted start: each open opening with no campaign waits under Needs you, linked to the filled-in form (V5)", async () => {
    start.mode = "assisted";
    const items = (await render()).wrapper.findAll('[data-test="needs-opening"]');
    expect(items.map((i) => i.text())).toEqual([expect.stringContaining("Joliet local has no campaign")]);
    expect(items[0]!.find("a").attributes("href")).toBe("/ads/campaigns?start=op-2");
  });

  it("Manual start, or someone who cannot start a campaign, sees no such row", async () => {
    expect((await render()).wrapper.findAll('[data-test="needs-opening"]')).toHaveLength(0);
    start.mode = "assisted";
    start.manages = false;
    expect((await render()).wrapper.findAll('[data-test="needs-opening"]')).toHaveLength(0);
  });
});
