import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { ADS_PERSON_DOOR_EXCLUDED, CAMPAIGN_STATES, CREATIVE_STATES, campaignEventsFrom, type AdsCampaignView, type AdsCreativeView, type CampaignState } from "@silvicom/shared";

/**
 * The campaign page (E3): the buttons are the machine's and the doors', the id is made once per form, an ad a
 * person has not seen cannot be decided, and Launch goes to an admin at amounts they typed.
 */
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: unknown }>, failNext: null as null | { code: string; message: string } }));
const who = vi.hoisted(() => ({ admin: false, manages: true }));
const state = vi.hoisted(() => ({ campaign: null as unknown, connections: [] as unknown[], kits: [] as unknown[] }));
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
vi.mock("./useAdsConnections", () => ({ useAdsConnections: () => ({ data: ref(state.connections) }) }));
vi.mock("./useAdsBrandKits", () => ({ useAdsBrandKits: () => ({ data: ref(state.kits) }) }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({ data: ref(state.campaign), isLoading: ref(false), isFetching: ref(false), error: ref(null), refetch: vi.fn() }),
  useMutation: (o: { mutationFn: (v: unknown) => Promise<void> }) => ({ isPending: ref(false), mutateAsync: o.mutationFn }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import AdsCampaignCreateDrawer from "./AdsCampaignCreateDrawer.vue";
import AdsCampaignDrawer from "./AdsCampaignDrawer.vue";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import { CAMPAIGN_STATE_LABEL, CAMPAIGN_STATE_TONE, CREATIVE_STATE_LABEL, canLaunchFrom, centsFrom, copyLines, isWorking, personMoves } from "./adsCampaignFlow";

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
const stubs = { SlideOver: slide, StepUpPrompt: { props: ["reason"], template: "<p data-test='step-up'>{{ reason }}</p>" } };
const drawer = () => mount(AdsCampaignDrawer, { props: { campaignId: ID }, global: { stubs } });

beforeEach(() => {
  api.calls = [];
  api.failNext = null;
  who.admin = false;
  who.manages = true;
  state.campaign = null;
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

  it("launch is offered from paused and nowhere else", () => {
    expect(CAMPAIGN_STATES.filter(canLaunchFrom)).toEqual(["paused"]);
  });

  it("the page keeps reading while the agent works and stops when a person's turn comes", () => {
    expect(isWorking("composing")).toBe(true);
    expect(isWorking("review")).toBe(false);
    expect(isWorking("paused")).toBe(false);
  });

  it("reads dollars as whole cents, and anything else as nothing", () => {
    expect(centsFrom("50")).toBe(5_000);
    expect(centsFrom("12.34")).toBe(1_234);
    for (const bad of ["", "  ", "0", "-5", "abc"]) expect(centsFrom(bad)).toBeNull();
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

  it("launch is an admin's, from paused only", () => {
    state.campaign = campaign("paused");
    expect(drawer().find("[data-test=launch-form]").exists()).toBe(false);
    who.admin = true;
    expect(drawer().find("[data-test=launch-form]").exists()).toBe(true);
    state.campaign = campaign("review");
    expect(drawer().find("[data-test=launch-form]").exists()).toBe(false);
  });

  it("launch approves the typed amounts, then launches at them", async () => {
    who.admin = true;
    state.campaign = campaign("paused");
    const w = drawer();
    expect(w.find("[data-test=launch]").attributes("disabled")).toBeDefined();
    await w.find("[data-test=daily]").setValue("50");
    await w.find("[data-test=lifetime]").setValue("500");
    await w.find("[data-test=launch-form]").trigger("submit");
    await flushPromises();
    const amounts = { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 };
    expect(api.calls).toEqual([
      { path: `/api/ads/campaigns/${ID}/approvals`, body: { kind: "launch", ...amounts } },
      { path: `/api/ads/campaigns/${ID}/launch`, body: amounts },
    ]);
  });

  it("a launch that needs a fresh sign-in asks for the password and sends no launch", async () => {
    who.admin = true;
    state.campaign = campaign("paused");
    api.failNext = { code: "step_up_required", message: "Confirm your password to spend." };
    const w = drawer();
    await w.find("[data-test=daily]").setValue("50");
    await w.find("[data-test=lifetime]").setValue("500");
    await w.find("[data-test=launch-form]").trigger("submit");
    await flushPromises();
    expect(w.find("[data-test=step-up]").text()).toContain("Confirm your password");
    expect(api.calls).toHaveLength(1);
  });

  it("shows why a campaign stopped", () => {
    state.campaign = { ...campaign("failed"), last_error: "render: no still model chosen yet (V4)" };
    expect(drawer().find("[data-test=campaign-error]").text()).toContain("V4");
  });
});
