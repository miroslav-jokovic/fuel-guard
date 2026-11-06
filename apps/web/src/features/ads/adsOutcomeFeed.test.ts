import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { LEAD_OUTCOME_STAGES, type AdsSettings, type AdsSettingsView } from "@silvicom/shared";
import { toFormValues, toSettings } from "./adsSettingsForm";

/**
 * Settings › Ads control's outcome feed (Q-AD40). The save replaces the WHOLE settings object, so the two traps
 * are pinned both ways: a save of any other section keeps the feed exactly as it was, and a save of the feed keeps
 * every other field exactly as it was. An older version with no feed group stays without one.
 */
const sent = vi.hoisted(() => ({ settings: [] as AdsSettings[] }));
const who = vi.hoisted(() => ({ admin: true }));
vi.mock("./useAdsSettings", () => ({
  useSaveAdsSettings: () => ({ isPending: ref(false), mutateAsync: async (s: AdsSettings) => (sent.settings.push(s), { version: 4 }) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin, can: () => who.admin }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import AdsSettingsForm from "./AdsSettingsForm.vue";

const MEMBER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
/** A version with every section filled, the feed on. */
const FULL: AdsSettings = {
  limits: { monthly_cap_cents: { meta: 300_000, simulator: 10_000 }, daily_max_cents: 2_000, lifetime_max_cents: 20_000, max_raise_pct: 25, max_raise_cents: 5_000 },
  auto_pause: { cpl_max_cents: 4_200, cpl_min_leads: 5, no_lead_spend_cents: 8_000, frequency_max: 3.5, pause_at_daily_cap: true, pause_when_filled: false },
  approvals: { second_approver_above_cents: 50_000 },
  budgets: { anthropic_tokens_monthly: 1_000_000, higgsfield_credits_monthly: 500, max_regenerations: 2, agents_enabled: { copywriter: true, renderer: true } },
  alerts: { recipients: { ads_overspend: [MEMBER] }, uncontacted_lead_minutes: 30 },
  outcome_feed: { enabled: true, dataset_id: "990000000201" },
};
/** The same version saved before the feed group existed. */
const { outcome_feed: _drop, ...OLDER } = FULL;

describe("the outcome feed in the settings form", () => {
  it("saving another section keeps the feed exactly as it was", () => {
    const out = toSettings(FULL, { ...toFormValues(FULL), daily_max: "25", recipients: { ...toFormValues(FULL).recipients, ads_overspend: [] } });
    expect(out.ok && out.settings.outcome_feed).toEqual({ enabled: true, dataset_id: "990000000201" });
  });

  it("saving the feed keeps every other field exactly as it was", () => {
    const out = toSettings(FULL, { ...toFormValues(FULL), outcome_feed_enabled: false, outcome_dataset_id: "770000000000001" });
    expect(out).toEqual({ ok: true, settings: { ...FULL, outcome_feed: { enabled: false, dataset_id: "770000000000001" } } });
  });

  it("a version from before the feed existed reads as off, and an unrelated save leaves it without a feed group", () => {
    const v = toFormValues(OLDER as AdsSettings);
    expect([v.outcome_feed_enabled, v.outcome_dataset_id]).toEqual([false, ""]);
    const out = toSettings(OLDER as AdsSettings, { ...v, daily_max: "25" });
    expect(out.ok && "outcome_feed" in out.settings).toBe(false);
  });

  it("turning it on with no dataset is refused in the contract's own words", () => {
    const out = toSettings(OLDER as AdsSettings, { ...toFormValues(OLDER as AdsSettings), outcome_feed_enabled: true });
    expect(out).toEqual({ ok: false, field: "outcome_feed.dataset_id", message: "Name the Meta dataset before turning the outcome feed on." });
  });
});

const view = (settings: AdsSettings): AdsSettingsView => ({
  settings, version: 3, kill_switch: false, kill_reason: null, saved_at: "2026-11-06T15:00:00Z", saved_by_name: "Miki",
});
const mountIt = (settings: AdsSettings) => {
  setActivePinia(createPinia());
  return mount(AdsSettingsForm, { props: { view: view(settings) } });
};
const submit = async (w: ReturnType<typeof mountIt>) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};

beforeEach(() => {
  sent.settings = [];
  who.admin = true;
});

describe("Settings › Ads control › Outcome feed", () => {
  it("an admin turning the feed on with a dataset posts the whole version, every other field as it was", async () => {
    const w = mountIt(OLDER as AdsSettings);
    await w.find('[data-test="outcome-dataset"]').setValue("990000000201");
    await w.find('[data-test="outcome-feed-switch"] button, [data-test="outcome-feed-switch"]').trigger("click");
    await submit(w);
    expect(sent.settings).toEqual([{ ...OLDER, outcome_feed: { enabled: true, dataset_id: "990000000201" } }]);
  });

  it("a save made from another section posts the feed unchanged", async () => {
    const w = mountIt(FULL);
    await w.findAll('input[type="number"]')[0]!.setValue("3500");
    await submit(w);
    expect(sent.settings[0]!.outcome_feed).toEqual(FULL.outcome_feed);
  });

  it("names every stage that is sent, and says the unrecorded ones are never sent", () => {
    const help = mountIt(FULL).find('[data-test="outcome-feed-help"]').text();
    expect([help.includes("Made an applicant"), help.includes("Hired"), help.includes("never sent, not even as a zero"), help.includes("Qualified")]).toEqual([true, true, true, true]);
    expect(LEAD_OUTCOME_STAGES.length).toBe(5);
  });

  it("a non-admin reads the feed but cannot change it", () => {
    who.admin = false;
    const w = mountIt(FULL);
    expect([w.find('[data-test="outcome-dataset"]').attributes("disabled"), (w.find('[data-test="outcome-dataset"]').element as HTMLInputElement).value])
      .toEqual(["", "990000000201"]);
  });
});
