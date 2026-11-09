import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { CampaignConcepts, CampaignState } from "@silvicom/shared";

/** The concepts table (CQ3's reader): shown once the campaign reached the platform, cost per lead "—" until a lead came. */
const state = vi.hoisted(() => ({ data: undefined as unknown, asked: [] as boolean[] }));
vi.mock("./useAdsCampaigns", () => ({
  useCampaignConcepts: (_id: unknown, enabled: { value: boolean }) => {
    state.asked.push(enabled.value);
    return { isLoading: ref(false), isFetching: ref(false), data: ref(state.data), error: ref(null), refetch: () => {} };
  },
}));
import AdsCampaignConcepts from "./AdsCampaignConcepts.vue";

const totals = (spend_cents: number, leads: number) => ({ spend_cents, impressions: 10, clicks: 1, leads, cost_per_lead_cents: leads > 0 ? Math.round(spend_cents / leads) : null });
const view: CampaignConcepts = {
  campaign_id: "c-1", since: "2026-10-12T18:00:00.000Z", read_at: "2026-11-09T18:00:00.000Z",
  concepts: [
    { preset_key: "P1", preset_version_ids: ["v1"], creatives: 2, ...totals(1500, 2), by_language: { en: totals(1000, 2), es: totals(500, 0) } },
    { preset_key: "P2", preset_version_ids: ["v2"], creatives: 1, ...totals(4000, 0), by_language: { en: totals(4000, 0), es: totals(0, 0) } },
  ],
};
const mountAt = (s: CampaignState) => mount(AdsCampaignConcepts, { props: { campaignId: "c-1", state: s } });

beforeEach(() => { state.data = view; state.asked = []; });

describe("AdsCampaignConcepts", () => {
  it("shows a line per concept with what it spent, its leads and cost per lead — and a dash, never $0, where no lead came", () => {
    const w = mountAt("live");
    const text = w.text();
    expect(w.find("[data-test=campaign-concepts]").exists()).toBe(true);
    expect(text).toContain("P1");
    expect(text).toContain("$15");
    expect(text).toContain("$7.50");
    expect(text).toContain("P2");
    expect(text).toContain("$40");
    expect(text).not.toContain("$0.00");
    expect((text.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("is not shown, and asks nothing, before the campaign reached the platform", () => {
    for (const s of ["draft", "composing", "review", "approved", "creating"] as CampaignState[]) {
      const w = mountAt(s);
      expect(w.find("[data-test=campaign-concepts]").exists()).toBe(false);
    }
    expect(state.asked.every((on) => on === false)).toBe(true);
  });

  it("says so when no ad has run yet", () => {
    state.data = { ...view, concepts: [] };
    expect(mountAt("paused").text()).toContain("No ad has run yet.");
  });
});
