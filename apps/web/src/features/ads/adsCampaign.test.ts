import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { ADS_PERSON_DOOR_EXCLUDED, CAMPAIGN_STATES, CREATIVE_STATES, campaignEventsFrom, type AdsCampaignView, type AdsCreativeView, type CampaignState } from "@silvicom/shared";

/**
 * The campaign page (E3b-1): the buttons are the machine's and the doors', the id is made once per form, an ad a
 * person has not seen cannot be decided, and each ad shows its three checks. Launch is E3b-2's (`adsLaunch.test.ts`).
 */
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: unknown }>, failNext: null as null | { code: string; message: string } }));
const who = vi.hoisted(() => ({ admin: false, manages: true }));
const state = vi.hoisted(() => ({ campaign: null as unknown, connections: [] as unknown[], kits: [] as unknown[], setupFailed: null as Error | null }));
vi.mock("@/lib/api", () => ({
  apiFetch: async (path: string, o: { body?: unknown } = {}) => {
    api.calls.push({ path, body: o.body });
    const e = api.failNext;
    api.failNext = null;
    return e ? { ok: false, error: e } : { ok: true, data: {} };
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin, can: () => who.manages }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("./useAdsConnections", () => ({ useAdsConnections: () => ({ data: ref(state.connections), error: ref(state.setupFailed) }) }));
vi.mock("./useAdsBrandKits", () => ({ useAdsBrandKits: () => ({ data: ref(state.kits), error: ref(null) }) }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({ data: ref(state.campaign), isLoading: ref(false), isFetching: ref(false), error: ref(null), refetch: vi.fn() }),
  useMutation: (o: { mutationFn: (v: unknown) => Promise<void> }) => ({ isPending: ref(false), mutateAsync: o.mutationFn }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import AdsCampaignCreateDrawer from "./AdsCampaignCreateDrawer.vue";
import AdsCampaignDrawer from "./AdsCampaignDrawer.vue";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import { CAMPAIGN_STATE_LABEL, CAMPAIGN_STATE_TONE, CREATIVE_STATE_LABEL, copyLines, isWorking, personMoves } from "./adsCampaignFlow";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONN = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const KIT = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const creative = (over: Partial<AdsCreativeView> = {}): AdsCreativeView => ({
  id: "cr-1", preset_version_id: "pv", brand_kit_version_id: "kv", supersedes_id: null, state: "ready",
  copy: { en: { headline: "Home every night", pay: 42 } }, regenerations: 0, last_error: null, checks: null, created_at: "2026-11-05T12:00:00Z",
  assets: [{ format: "1:1", language: "en", sha256: "a".repeat(64), path: "o/a.png", width: 1080, height: 1080, url: "https://store/a" }],
  ...over,
});
const campaign = (s: CampaignState, creatives: AdsCreativeView[] = [creative()]) => ({ id: ID, name: "Dallas drivers", state: s, last_error: null, creatives }) as unknown as AdsCampaignView;
const slide = { template: "<div><slot /><slot name='footer' /></div>" };
const stubs = { SlideOver: slide };
const drawer = () => mount(AdsCampaignDrawer, { props: { campaignId: ID }, global: { stubs } });

beforeEach(() => {
  api.calls = [];
  api.failNext = null;
  who.admin = false;
  who.manages = true;
  state.campaign = null;
  state.setupFailed = null;
  state.connections = [{ id: CONN, provider: "simulator", status: "connected", account_ref: "990000000001" }];
  state.kits = [{ id: KIT, name: "Main", archived_at: null, current: {} }];
  setActivePinia(createPinia());
});

describe("adsCampaignFlow — the machine decides, this words it", () => {
  it("every state and creative state has words and a tone", () => {
    for (const s of CAMPAIGN_STATES) {
      expect(CAMPAIGN_STATE_LABEL[s]).toBeTruthy();
      expect(CAMPAIGN_STATE_TONE[s]).toBeTruthy();
    }
    for (const s of CREATIVE_STATES) expect(CREATIVE_STATE_LABEL[s]).toBeTruthy();
  });

  it("offers exactly the machine's person events from every state, each with words, and never kill or launch", () => {
    for (const s of CAMPAIGN_STATES) {
      const expected = campaignEventsFrom(s).filter((t) => t.by.includes("person") && !ADS_PERSON_DOOR_EXCLUDED.includes(t.event)).map((t) => t.event);
      const moves = personMoves(s);
      expect(moves.map((m) => m.event)).toEqual(expected);
      for (const m of moves) expect(m.label).not.toBe(m.event);
      expect(moves.map((m) => m.event)).not.toContain("launch");
      expect(moves.map((m) => m.event)).not.toContain("kill");
    }
  });

  it("the page keeps reading while the agent works and stops when a person's turn comes", () => {
    expect(isWorking("composing")).toBe(true);
    expect(isWorking("review")).toBe(false);
    expect(isWorking("paused")).toBe(false);
  });

  it("lists one language's copy and skips anything that is not text", () => {
    expect(copyLines(creative().copy, "en")).toEqual([{ slot: "headline", text: "Home every night" }]);
    expect(copyLines(null, "en")).toEqual([]);
    expect(copyLines(creative().copy, "es")).toEqual([]);
  });
});

describe("AdsCampaignCreateDrawer", () => {
  const openings = [{ value: "op-1", label: "Dallas OTR" }];
  const mountIt = () => mount(AdsCampaignCreateDrawer, { props: { open: true, openings }, global: { stubs } });

  it("cannot start without an opening, and chooses the only account and kit itself", async () => {
    const w = mountIt();
    expect(w.find("[data-test=start-campaign]").attributes("disabled")).toBeDefined();
    await w.find("[data-test=campaign-form]").trigger("submit");
    expect(api.calls).toEqual([]);
    await w.find("select[data-test=opening]").setValue("op-1");
    expect(w.find("[data-test=start-campaign]").attributes("disabled")).toBeUndefined();
  });

  it("two presses send the same id, so the door finds the first campaign", async () => {
    api.failNext = { code: "x", message: "Try again" };
    const w = mountIt();
    await w.find("select[data-test=opening]").setValue("op-1");
    await w.find("[data-test=campaign-form]").trigger("submit");
    await flushPromises();
    await w.find("[data-test=campaign-form]").trigger("submit");
    await flushPromises();
    const [a, b] = api.calls.map((c) => c.body as { id: string; brief_source: string; brief_ref: string; connection_id: string; brand_kit_id: string });
    expect(a!.id).toBe(b!.id);
    expect(a).toMatchObject({ brief_source: "recruiting_opening", brief_ref: "op-1", connection_id: CONN, brand_kit_id: KIT });
    expect(w.emitted("created")).toEqual([[a!.id]]);
  });

  it("each opening of the form makes a new campaign id, so a second campaign is never the first one again", async () => {
    const w = mountIt();
    await w.find("select[data-test=opening]").setValue("op-1");
    await w.find("[data-test=campaign-form]").trigger("submit");
    await flushPromises();
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await w.find("select[data-test=opening]").setValue("op-1");
    await w.find("[data-test=campaign-form]").trigger("submit");
    await flushPromises();
    const [a, b] = api.calls.map((c) => (c.body as { id: string }).id);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("a refused create shows the API's sentence", async () => {
    api.failNext = { code: "settings_not_saved", message: "Save the ads spending limits before creating a campaign." };
    const w = mountIt();
    await w.find("select[data-test=opening]").setValue("op-1");
    await w.find("[data-test=campaign-form]").trigger("submit");
    await flushPromises();
    expect(w.find("[data-test=campaign-refusal]").text()).toContain("Save the ads spending limits");
    expect(w.emitted("created")).toBeUndefined();
  });

  it("says what is missing when no account is connected, and a failing account is not offered", () => {
    state.connections = [{ id: CONN, provider: "meta", status: "failing", account_ref: "1" }];
    expect(mountIt().find("[data-test=setup-missing]").exists()).toBe(true);
  });

  it("a failed read of the accounts says it failed, never that nothing is set up", () => {
    state.connections = [];
    state.setupFailed = new Error("down");
    const w = mountIt();
    expect(w.find("[data-test=setup-unread]").exists()).toBe(true);
    expect(w.find("[data-test=setup-missing]").exists()).toBe(false);
  });
});

describe("AdsCreativeReview", () => {
  const review = (c: AdsCreativeView, canDecide = true) => mount(AdsCreativeReview, { props: { creative: c, canDecide, busy: false } });

  it("shows the image and its copy", () => {
    const w = review(creative());
    expect(w.find("[data-test=ad-image]").attributes("src")).toBe("https://store/a");
    expect(w.text()).toContain("Home every night");
  });

  it("an ad whose image could not be linked says so", () => {
    const w = review(creative({ assets: [{ ...creative().assets[0]!, url: null }] }));
    expect(w.find("[data-test=no-image]").exists()).toBe(true);
  });

  it("a rejection needs a reason, and sends it", async () => {
    const w = review(creative());
    await w.find("[data-test=reject]").trigger("click");
    expect(w.find("[data-test=confirm-reject]").attributes("disabled")).toBeDefined();
    await w.find("[data-test=reject-reason]").setValue("  Wrong truck  ");
    await w.find("[data-test=confirm-reject]").trigger("click");
    expect(w.emitted("reject")).toEqual([["Wrong truck"]]);
  });

  it("only a ready ad can be decided, and only by someone who may", () => {
    expect(review(creative({ state: "check_failed", last_error: "visual: a logo" })).find("[data-test=approve]").exists()).toBe(false);
    expect(review(creative({ state: "check_failed", last_error: "visual: a logo" })).find("[data-test=creative-error]").text()).toContain("a logo");
    expect(review(creative(), false).find("[data-test=approve]").exists()).toBe(false);
  });

  it("shows the three checks for every format and language, with the checker's reason where one failed", () => {
    const checks = { copy: { ok: true }, render: { ok: true }, visual: { ok: false }, visual_attempts: [{ attempt: 1, visual: { "1:1": [{ check: "no_foreign_logos", verdict: "fail", reason: "A logo on the cab door." }] } }] };
    const w = review(creative({ state: "check_failed", checks, last_error: "visual check failed after 1 attempt(s)" }));
    const es = w.find("[data-test=\"checks-1:1-es\"]");
    expect(es.text()).toContain("1:1 · ES");
    expect(es.findAll("[data-test=check]").map((t) => t.text())).toEqual(["WordsPassed", "Text on the picturePassed", "PictureFailedA logo on the cab door."]);
    expect(w.findAll("[data-test^=\"checks-1\"]")).toHaveLength(2);
  });

  it("checks it cannot read say so instead of drawing passes", () => {
    const w = review(creative({ checks: { copy: { ok: "yes" } } }));
    expect(w.find("[data-test=checks-unreadable]").exists()).toBe(true);
    expect(w.find("[data-test=checks]").exists()).toBe(false);
  });
});

describe("AdsCampaignDrawer", () => {
  it("a manager decides an ad in review and approves the campaign through the doors", async () => {
    state.campaign = campaign("review");
    const w = drawer();
    await w.find("[data-test=approve]").trigger("click");
    await flushPromises();
    await w.find("[data-test=move-creatives_approved]").trigger("click");
    await flushPromises();
    expect(api.calls).toEqual([
      { path: `/api/ads/campaigns/${ID}/creatives/cr-1/decision`, body: { decision: "approve" } },
      { path: `/api/ads/campaigns/${ID}/moves`, body: { event: "creatives_approved" } },
    ]);
  });

  it("someone who only reads sees the ads and no button", () => {
    who.manages = false;
    state.campaign = campaign("review");
    const w = drawer();
    expect(w.find("[data-test=creative]").exists()).toBe(true);
    expect(w.find("[data-test=approve]").exists()).toBe(false);
    expect(w.find("[data-test=move-regenerate]").exists()).toBe(false);
  });

  it("an ad outside review cannot be decided", () => {
    state.campaign = campaign("paused");
    expect(drawer().find("[data-test=approve]").exists()).toBe(false);
  });

  it("shows why a campaign stopped", () => {
    state.campaign = { ...campaign("failed"), last_error: "render: no still model chosen yet (V4)" };
    expect(drawer().find("[data-test=campaign-error]").text()).toContain("V4");
  });
});
