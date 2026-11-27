import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { ADS_SETTINGS_UNSET, type AdsHealthView, type AdsSettings } from "@silvicom/shared";

/**
 * Ads › Automation draws the health read as given; a failed read says so instead of drawing an idle machine. Its first
 * card (V5) is who does each step, read from the shared step table and the saved settings.
 */
const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as unknown, settings: null as unknown, settingsError: null as unknown, canOpenSettings: false }));
vi.mock("@/features/ads/useAdsOverview", () => ({
  useAdsHealth: () => ({ isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(state.error), refetch: () => {} }),
}));
vi.mock("@/features/ads/useAdsSettings", () => ({
  useAdsSettings: () => ({ isLoading: ref(false), isFetching: ref(false), data: ref(state.settings ? { settings: state.settings } : undefined), error: ref(state.settingsError), refetch: () => {} }),
}));
// V7e's card has its own read and its own test (`AdsConversionLeadsCard.test.ts`).
vi.mock("@/features/ads/useAdsConversionLeads", () => ({ useAdsConversionLeads: () => ({ isLoading: ref(true), isFetching: ref(false), data: ref(undefined), error: ref(null), refetch: () => {} }) }));
vi.mock("@/features/ads/useAdsTabs", () => ({ useAdsTabs: () => ({ tabs: computed(() => []), canOpenSettings: computed(() => state.canOpenSettings) }) }));
import AdsAutomationPage from "./AdsAutomationPage.vue";

const VIEW: AdsHealthView = {
  checked_at: "2026-11-18T15:00:00Z", month: "2026-11",
  connections: [{
    id: "c1", provider: "meta", is_sandbox: true, status: "connected", last_test_at: "2026-11-18T14:00:00Z", last_error: null,
    token: { expiry: null, days_left: 5, tone: "warn", words: "Expires on 11/23/2026, in 5 days." },
  }],
  lead_webhook: { last_at: null },
  jobs: [{ kind: "ads_insights", label: "Ads insights", done: 3, failed: 1, running: 0, last_done_at: null, last_failed_at: "2026-11-18T10:01:00Z", last_error: "insights: rate limited", tone: "bad" }],
  agents: [{ agent: "strategist", enabled: true, calls: 4, in_shape: 3, failed: 1, budget_refused: 0, in_shape_share: 0.75, failures: [{ code: "bad_shape", count: 1 }], cost_units: 9_000, cost_unit: "tokens" }],
};

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:rest(.*)", component: { template: "<div />" } }] });
const render = () => mount(AdsAutomationPage, { global: { plugins: [router], stubs: { PageHeader: true, AdsTabs: true } } });
const step = (w: ReturnType<typeof render>, key: string) => w.find(`[data-step="${key}"]`);

beforeEach(() => {
  state.data = VIEW;
  state.error = null;
  state.settings = ADS_SETTINGS_UNSET;
  state.settingsError = null;
  state.canOpenSettings = false;
});

describe("AdsAutomationPage", () => {
  it("draws the connections, the lead webhook, the week's jobs and the month's agents", () => {
    const text = render().text();
    for (const s of [
      "Meta (Facebook, Instagram) · sandbox", "Expires on 11/23/2026, in 5 days.", "Meta has not told us of a lead yet.",
      "Ads insights", "insights: rate limited", "Plans the campaign", "75% (3 of 4)", "bad_shape × 1", "9,000 tokens",
    ]) expect(text, s).toContain(s);
  });

  it("a failed read is a failure on screen", () => {
    state.data = undefined;
    state.error = new Error("down");
    expect(render().text()).toContain("Could not load the ads health.");
  });
});

describe("Who does each step (V5)", () => {
  it("shows every step with the mode in force, read from the saved settings", () => {
    const w = render();
    expect(w.findAll("[data-step]").map((r) => r.attributes("data-step"))).toEqual(["start_campaign", "approve_plan", "approve_ad", "launch", "replace_tired_ad", "lower_budget"]);
    expect(step(w, "start_campaign").find('[data-test="mode"]').text()).toBe("Manual");
    expect(step(w, "replace_tired_ad").find('[data-test="mode"]').text()).toBe("Manual");
    const on: AdsSettings = { ...ADS_SETTINGS_UNSET, modes: { start_campaign: "assisted" }, creative_refresh: { ...ADS_SETTINGS_UNSET.creative_refresh, retire: true } };
    state.settings = on;
    const again = render();
    expect(step(again, "start_campaign").find('[data-test="mode"]').text()).toBe("Assisted");
    expect(step(again, "replace_tired_ad").find('[data-test="mode"]').text()).toBe("Assisted");
  });

  it("a locked mode says what opens it; an open one says where it is changed, to whoever may open Settings", () => {
    const w = render();
    expect(step(w, "launch").find('[data-test="other-autopilot"]').text()).toContain("Autopilot is locked. Opens after the canary");
    expect(step(w, "approve_ad").find('[data-test="other-autopilot"]').text()).toContain("Level C");
    expect(step(w, "start_campaign").find('[data-test="other-assisted"]').text()).toContain("Assisted is available");
    expect(step(w, "start_campaign").find("a").exists()).toBe(false);
    state.canOpenSettings = true;
    expect(step(render(), "start_campaign").find("a").attributes("href")).toBe("/ads/settings");
  });

  it("a failed settings read says so instead of drawing every step as Manual", () => {
    state.settings = null;
    state.settingsError = new Error("down");
    const w = render();
    expect(w.text()).toContain("Could not load the ads settings.");
    expect(w.findAll("[data-step]")).toHaveLength(0);
  });
});
