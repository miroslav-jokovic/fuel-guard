import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { CAMPAIGN_STATES, type AdsCampaignView, type CampaignState } from "@silvicom/shared";

/**
 * Launch (E3b-2): an admin's, from the state the machine launches from, at amounts they typed, behind a fresh
 * sign-in; and when the launch gate refuses, the parts that are missing in the office's words.
 */
type Answer = { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string }; detail?: Record<string, unknown> };
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: unknown }>, answers: [] as Answer[] }));
const who = vi.hoisted(() => ({ admin: true }));
const state = vi.hoisted(() => ({ campaign: null as unknown, refreshed: 0 }));
vi.mock("@/lib/api", () => ({
  apiFetch: async (path: string, o: { body?: unknown } = {}) => (api.calls.push({ path, body: o.body }), api.answers.shift() ?? { ok: true, data: {} }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin, can: () => true }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({ data: ref(state.campaign), isLoading: ref(false), isFetching: ref(false), error: ref(null), refetch: vi.fn() }),
  useMutation: (o: { mutationFn: (v: unknown) => Promise<void>; onSettled?: () => unknown }) => ({
    isPending: ref(false),
    mutateAsync: async (v: unknown) => { try { await o.mutationFn(v); } finally { await o.onSettled?.(); } },
  }),
  useQueryClient: () => ({ invalidateQueries: () => { state.refreshed += 1; } }),
}));

import AdsCampaignDrawer from "./AdsCampaignDrawer.vue";
import { canLaunchFrom, centsFrom } from "./adsCampaignFlow";
import { launchMissingFrom } from "./useAdsCampaigns";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const campaign = (s: CampaignState) => ({ id: ID, name: "Dallas drivers", state: s, last_error: null, creatives: [] }) as unknown as AdsCampaignView;
const stubs = { SlideOver: { template: "<div><slot /><slot name='footer' /></div>" }, StepUpPrompt: { props: ["reason"], template: "<p data-test='step-up'>{{ reason }}</p>" } };
const drawer = () => mount(AdsCampaignDrawer, { props: { campaignId: ID }, global: { stubs } });
async function launchAt(w: ReturnType<typeof drawer>, daily: string, lifetime: string): Promise<void> {
  await w.find("[data-test=daily]").setValue(daily);
  await w.find("[data-test=lifetime]").setValue(lifetime);
  await w.find("[data-test=launch-form]").trigger("submit");
  await flushPromises();
}
const NOT_CERTIFIED: Answer = {
  ok: false, error: { code: "not_certified", message: "Not launched: 2 of the 10 parts … Renderer / Higgsfield client at L3." },
  detail: { missing: [{ worker: "Renderer / Higgsfield client", platform: null, level: "L3", needs: "L4" }, { worker: "Publisher (per adapter)", platform: "meta", level: "L3", needs: "L4" }] },
};

beforeEach(() => {
  api.calls = [];
  api.answers = [];
  who.admin = true;
  state.campaign = campaign("paused");
  state.refreshed = 0;
  setActivePinia(createPinia());
});

describe("launch — who, from where, at what", () => {
  it("is offered from paused and nowhere else, as the machine says", () => {
    expect(CAMPAIGN_STATES.filter(canLaunchFrom)).toEqual(["paused"]);
  });

  it("is an admin's: anyone else who manages recruiting sees no launch form", () => {
    expect(drawer().find("[data-test=launch-form]").exists()).toBe(true);
    who.admin = false;
    expect(drawer().find("[data-test=launch-form]").exists()).toBe(false);
    who.admin = true;
    state.campaign = campaign("review");
    expect(drawer().find("[data-test=launch-form]").exists()).toBe(false);
  });

  it("reads dollars as whole cents, and anything else as nothing", () => {
    expect(centsFrom("50")).toBe(5_000);
    expect(centsFrom("12.34")).toBe(1_234);
    expect(centsFrom("0.29")).toBe(29); // 0.29 × 100 is 28.999…: rounded, not cut
    for (const bad of ["", "  ", "0", "-5", "abc"]) expect(centsFrom(bad)).toBeNull();
  });

  it("approves the typed amounts, then launches at exactly them", async () => {
    const w = drawer();
    expect(w.find("[data-test=launch]").attributes("disabled")).toBeDefined();
    await launchAt(w, "50", "500");
    const amounts = { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 };
    expect(api.calls).toEqual([
      { path: `/api/ads/campaigns/${ID}/approvals`, body: { kind: "launch", ...amounts } },
      { path: `/api/ads/campaigns/${ID}/launch`, body: amounts },
    ]);
  });

  it("a launch with no amounts sends nothing, even if the form is submitted", async () => {
    const w = drawer();
    await w.find("[data-test=launch-form]").trigger("submit");
    await flushPromises();
    expect(api.calls).toEqual([]);
  });

  it("a launch that needs a fresh sign-in asks for the password and sends no launch", async () => {
    api.answers = [{ ok: false, error: { code: "step_up_required", message: "Confirm your password to spend." } }];
    const w = drawer();
    await launchAt(w, "50", "500");
    expect(w.find("[data-test=step-up]").text()).toContain("Confirm your password");
    expect(api.calls).toHaveLength(1);
  });
});

describe("launch — when the launch gate says the agent is not ready", () => {
  it("names the missing parts in office words, never the registry's names or levels", async () => {
    api.answers = [{ ok: true }, NOT_CERTIFIED];
    const w = drawer();
    await launchAt(w, "50", "500");
    expect(w.findAll("[data-test=missing-part]").map((l) => l.text())).toEqual(["Making the pictures", "Putting the ads on the platform, on Meta (Facebook, Instagram)"]);
    expect(w.find("[data-test=not-certified]").text()).not.toMatch(/L3|L4|Higgsfield client/);
  });

  it("says the refusal once: the door's own sentence is hidden while the office list shows it", async () => {
    api.answers = [{ ok: true }, NOT_CERTIFIED];
    state.campaign = { ...campaign("paused"), last_error: "Not launched: … Renderer / Higgsfield client at L3." };
    const w = drawer();
    expect(w.find("[data-test=campaign-error]").exists()).toBe(true);
    await launchAt(w, "50", "500");
    expect(w.find("[data-test=not-certified]").exists()).toBe(true);
    expect(w.find("[data-test=campaign-error]").exists()).toBe(false);
  });

  it("reads the campaign again after a refusal, so the reason the door wrote shows", async () => {
    api.answers = [{ ok: true }, NOT_CERTIFIED];
    await launchAt(drawer(), "50", "500");
    expect(state.refreshed).toBe(1);
  });

  it("a second, successful launch clears the list", async () => {
    api.answers = [{ ok: true }, NOT_CERTIFIED];
    const w = drawer();
    await launchAt(w, "50", "500");
    await w.find("[data-test=launch-form]").trigger("submit");
    await flushPromises();
    expect(w.find("[data-test=not-certified]").exists()).toBe(false);
  });

  it("only a not_certified refusal with a readable list is one", () => {
    const refusal = (code: string, missing: unknown) => Object.assign(new Error("x"), { code, detail: { missing } });
    expect(launchMissingFrom(refusal("not_certified", NOT_CERTIFIED.ok ? [] : NOT_CERTIFIED.detail!.missing))).toHaveLength(2);
    expect(launchMissingFrom(refusal("simulator_not_allowed", []))).toBeNull();
    expect(launchMissingFrom(refusal("platform_not_listed", [{ worker: "Copywriter", platform: null, level: "L2", needs: "L4" }]))).toBeNull();
    expect(launchMissingFrom(refusal("not_certified", [{ worker: 1 }]))).toBeNull();
    expect(launchMissingFrom(refusal("not_certified", []))).toBeNull();
  });
});
