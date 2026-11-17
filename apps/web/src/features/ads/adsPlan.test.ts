import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { AD_HOOK_FAMILIES, AD_SCENE_FAMILIES, CAMPAIGN_STATES, PLAN_EVIDENCE_KINDS, campaignPlanSchema, type AdsCampaignPlanView, type CampaignPlan, type PlanAngle } from "@silvicom/shared";

/**
 * The plan review screen (ADS-PLATFORM-V2-PLAN V2c): a person reads the plan with the facts under it, edits it
 * or approves it (from the drawer's footer) — only while it waits for review, only if they manage recruiting — and a refused edit says why.
 */
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: unknown }>, failNext: null as null | { error: { code: string; message: string }; detail?: unknown } }));
const state = vi.hoisted(() => ({ read: null as unknown, campaign: null as unknown, enabled: [] as boolean[] }));
const who = vi.hoisted(() => ({ manages: true }));
const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: async (path: string, o: { body?: unknown } = {}) => {
    api.calls.push({ path, body: o.body });
    const e = api.failNext;
    api.failNext = null;
    return e ? { ok: false, error: e.error, detail: e.detail } : { ok: true, data: {} };
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: false, can: () => who.manages }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: (m: string) => toasts.success.push(m), error: (m: string) => toasts.error.push(m) }) }));
vi.mock("@tanstack/vue-query", () => ({
  // The plan's read and the campaign's are told apart by their key, as the cache tells them apart.
  useQuery: (o: { queryKey: unknown[]; enabled: () => boolean }) => {
    const isPlan = o.queryKey.at(-1) === "plan";
    if (isPlan) state.enabled.push(o.enabled());
    return { data: ref(isPlan ? state.read : state.campaign), isLoading: ref(false), isFetching: ref(false), error: ref(null), refetch: vi.fn() };
  },
  useMutation: (o: { mutationFn: (v: unknown) => Promise<void> }) => ({ isPending: ref(false), mutateAsync: o.mutationFn }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import AdsCampaignDrawer from "./AdsCampaignDrawer.vue";
import AdsCampaignPlan from "./AdsCampaignPlan.vue";
import {
  EVIDENCE_KIND_LABEL, authorLine, canRemoveAngle, conceptKey, conceptLabel, conceptOptions, draftErrors, editFrom, editablePlan, factsFor, formatLabel, formatOptions, mayHavePlan, planIsOpen, planRefusalLines, setConcept, setFormat, showsFormat,
} from "./adsPlan";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PLAN_ID = "71000000-0000-4000-8000-000000000001";
const angle = (over: Partial<PlanAngle>): PlanAngle => ({
  hook_family: "pay_first", scene_family: "equipment_on_road", format: "still",
  idea: "Lead with the pay per mile, stated plainly.", proof: "The opening's own pay figure.",
  why: "Pay is the first thing a driver compares between carriers.", evidence: ["job:claim_1"], ...over,
});
const plan = (n = 4): CampaignPlan => ({
  audience: "Experienced regional flatbed drivers who want a week they can plan around.",
  audience_evidence: ["job:subject", "lead_outcome:closed_out_of_area"],
  angles: [
    angle({}),
    angle({ hook_family: "life_first", scene_family: "home_street", idea: "Lead with being home on the schedule the job states.", evidence: ["job:claim_2"] }),
    angle({ hook_family: "equipment_first", scene_family: "equipment_at_rest", idea: "Lead with the flatbed work and the assigned truck.", evidence: ["job:subject", "our_result:pay_first_cab_pov"] }),
    angle({ hook_family: "straight_talk", scene_family: "abstract_plate", idea: "Say plainly who the job is for and where it runs.", evidence: ["job:subject"] }),
  ].slice(0, n),
});
/** What the carrier can make: the four kinds the plan uses, and one more. */
const CONCEPTS = [...plan().angles.map((a) => ({ hook_family: a.hook_family, scene_family: a.scene_family })), { hook_family: "pay_first" as const, scene_family: "cab_pov" as const }];
const view = (over: Partial<AdsCampaignPlanView> = {}): AdsCampaignPlanView => ({
  id: PLAN_ID, version: 1, plan: plan(), author_kind: "agent", author_name: null, created_at: "2026-11-15T18:30:00Z",
  evidence: [
    { id: "job:subject", kind: "job", text: "The job: Class A regional truck driver.", source: null },
    { id: "job:claim_1", kind: "job", text: "The opening pays $0.68 per mile.", source: null },
    { id: "job:claim_2", kind: "job", text: "The opening offers: home weekly.", source: null },
    { id: "lead_outcome:closed_out_of_area", kind: "lead_outcome", text: "19 of 46 of our ad leads in the last 28 days were closed as: out of area.", source: null },
    { id: "our_result:pay_first_cab_pov", kind: "our_result", text: "Our ads with hook pay_first spent $612.40 and brought 31 leads.", source: null },
  ],
  ...over,
});
const show = (s: (typeof CAMPAIGN_STATES)[number] = "plan_review", canManage = true) => mount(AdsCampaignPlan, { props: { campaignId: ID, state: s, canManage } });

/** The whole drawer, for the action that lives in its footer. */
const drawer = (s: (typeof CAMPAIGN_STATES)[number] = "plan_review") => {
  state.campaign = { id: ID, name: "Joliet drivers", state: s, last_error: null, creatives: [] };
  return mount(AdsCampaignDrawer, { props: { campaignId: ID }, global: { stubs: { SlideOver: { template: "<div><slot /><slot name='footer' /></div>" } } } });
};

beforeEach(() => {
  who.manages = true;
  state.campaign = null;
  api.calls = [];
  api.failNext = null;
  state.read = { plan: view(), concepts: CONCEPTS, formats: ["still"] };
  state.enabled = [];
  toasts.success = [];
  toasts.error = [];
});

describe("adsPlan — the contract decides, this words it", () => {
  it("every kind of fact has office words, and every lead and picture pair has a label and a key that reads back", () => {
    for (const k of PLAN_EVIDENCE_KINDS) expect(EVIDENCE_KIND_LABEL[k]).toBeTruthy();
    for (const hook_family of AD_HOOK_FAMILIES) for (const scene_family of AD_SCENE_FAMILIES) {
      const a = angle({});
      setConcept(a, conceptKey({ hook_family, scene_family }));
      expect([a.hook_family, a.scene_family]).toEqual([hook_family, scene_family]);
      expect(conceptLabel({ hook_family, scene_family })).toMatch(/^[A-Z].*, picture: /);
    }
    const kept = angle({});
    setConcept(kept, "nonsense+cab_pov");
    expect(kept.hook_family).toBe("pay_first");
  });

  it("an idea is offered the kinds of ad the carrier can make, and its own kind marked if that can no longer be made", () => {
    expect(conceptOptions(CONCEPTS, angle({})).map((o) => o.value)).toEqual(CONCEPTS.map(conceptKey));
    const gone = conceptOptions(CONCEPTS, angle({ hook_family: "proof", scene_family: "cab_pov" }));
    expect(gone).toHaveLength(CONCEPTS.length + 1);
    expect(gone[0]).toEqual({ value: "proof+cab_pov", label: "Proof, picture: from the cab (cannot be made now)" });
  });

  it("a plan can exist from plan review onward, and is open only in plan review", () => {
    expect(CAMPAIGN_STATES.filter((s) => !mayHavePlan(s))).toEqual(["draft", "planning"]);
    expect(CAMPAIGN_STATES.filter(planIsOpen)).toEqual(["plan_review"]);
  });

  it("gives the facts a part rests on in the order cited, leaving out an id the plan's list does not hold", () => {
    expect(factsFor(view(), ["lead_outcome:closed_out_of_area", "job:nope", "job:subject"]).map((f) => f.id)).toEqual(["lead_outcome:closed_out_of_area", "job:subject"]);
  });

  it("says who wrote the version", () => {
    expect(authorLine(view())).toBe("Version 1, written by the planning agent");
    expect(authorLine(view({ version: 2, author_kind: "person", author_name: "Koni" }))).toBe("Version 2, edited by Koni");
  });

  it("the form's copy is its own: changing it does not change the plan shown", () => {
    const shown = plan();
    const copy = editablePlan(shown);
    copy.audience = "x";
    copy.angles[0]!.evidence.push("job:y");
    copy.angles.pop();
    expect(shown).toEqual(plan());
  });

  it("an idea can be removed only while more than the contract's fewest remain", () => {
    expect(canRemoveAngle(plan(4))).toBe(true);
    expect(canRemoveAngle(plan(3))).toBe(false);
  });

  it("what is sent is the contract's own parse — trimmed — and nothing is sent when the contract would refuse it", () => {
    const sent = editFrom({ ...plan(), audience: `  ${plan().audience}  ` }, 2)!;
    expect(sent).toEqual({ based_on_version: 2, plan: plan() });
    expect(editFrom({ ...plan(), audience: "too short" }, 2)).toBeNull();
  });

  it("names the field the contract objects to, too short or too long, by the contract's own limits", () => {
    expect(draftErrors(plan())).toEqual({});
    const long = "x".repeat(2000);
    const errs = draftErrors({ ...plan(), audience: "short", angles: [angle({ idea: long }), ...plan().angles.slice(1)] });
    expect(errs).toEqual({ audience: "Write a little more here.", "angles.0.idea": "This is too long. Shorten it." });
    // Not a restated limit: the same draft is what the contract refuses.
    expect(campaignPlanSchema.safeParse({ ...plan(), audience: "short" }).success).toBe(false);
  });

  it("words each of the door's findings for an office reader, and falls back to the door's sentence for a kind it does not know", () => {
    expect(planRefusalLines({ findings: [
      { kind: "claim", where: "audience", finding: "money_not_in_brief", text: "$0.80" },
      { kind: "same_kind", where: "angle 2", other: "angle 1" },
      { kind: "no_job_evidence", where: "angle 3" },
      { kind: "unknown_evidence", where: "angle 1", id: "market:x" },
      { kind: "format_not_built", where: "angle 4", format: "motion" },
      { kind: "claim", where: "angle 2 why", finding: "term_not_in_brief", text: "sign-on bonus" },
      { kind: "concept_not_available", where: "angle 3" },
      { kind: "new_rule", where: "angle 1", message: "The door's own sentence." },
    ], off_schema: null })).toEqual([
      'Who the ads speak to names pay the opening does not offer ("$0.80").',
      "Idea 2 leads with the same thing and shows the same picture as idea 1. Change one of them.",
      "Idea 3 rests on no fact of the job.",
      "Idea 1 rests on a fact that is not in this plan's list.",
      "Idea 4 is a short video, which cannot be made for this campaign. Choose another format.",
      'Idea 2, why this idea promises something the opening does not offer ("sign-on bonus").',
      "Idea 3 is a kind of ad with no enabled preset. Choose another kind, or enable its preset in Settings.",
      "The door's own sentence.",
    ]);
    expect(planRefusalLines({ findings: [], off_schema: "plan: invalid" })).toEqual(["The plan is incomplete. Fill every part of it."]);
    expect(planRefusalLines(undefined)).toEqual([]);
  });
});

describe("AdsCampaignPlan — reading", () => {
  it("shows who the ads speak to, each idea with what it leads with and its picture, and the facts under each", () => {
    const w = show();
    expect(w.get("[data-test='plan-author']").text()).toBe("Version 1, written by the planning agent");
    expect(w.get("[data-test='plan-audience']").text()).toContain("regional flatbed drivers");
    expect(w.get("[data-test='plan-audience-facts']").text()).toContain("Our earlier applicants: 19 of 46 of our ad leads");
    const angles = w.findAll("[data-test='plan-angle']");
    expect(angles).toHaveLength(4);
    expect(angles[0]!.get("[data-test='plan-hook']").text()).toBe("Leads with: Pay first");
    expect(angles[0]!.get("[data-test='plan-scene']").text()).toBe("Picture: Truck on the road");
    expect(angles[0]!.get("[data-test='plan-angle-facts']").text()).toContain("The job: The opening pays $0.68 per mile.");
    expect(angles[2]!.get("[data-test='plan-angle-facts']").text()).toContain("The facts behind this (2)");
    expect(angles[2]!.get("[data-test='plan-angle-facts']").text()).toContain("Our earlier ads:");
  });

  it("asks for no plan while the campaign is still being planned, and draws nothing", () => {
    for (const s of ["draft", "planning"] as const) {
      state.enabled = [];
      expect(show(s).find("[data-test='campaign-plan']").exists(), s).toBe(false);
      expect(state.enabled, s).toEqual([false]);
    }
    show("plan_review");
    expect(state.enabled.at(-1)).toBe(true);
  });

  it("a campaign with no plan (made before planning existed) shows nothing rather than an empty plan", () => {
    state.read = { plan: null, concepts: [], formats: [] };
    const w = show("review");
    expect(w.find("[data-test='plan-author']").exists()).toBe(false);
    expect(w.find("[data-test='plan-edit']").exists()).toBe(false);
  });

  it("offers Edit only in plan review and only to someone who manages recruiting; afterwards the plan stays, read-only", () => {
    expect(show("plan_review").find("[data-test='plan-edit']").exists()).toBe(true);
    expect(show("plan_review", false).find("[data-test='plan-edit']").exists()).toBe(false);
    for (const s of CAMPAIGN_STATES.filter((x) => x !== "plan_review" && mayHavePlan(x))) {
      const w = show(s);
      expect(w.find("[data-test='plan-edit']").exists(), s).toBe(false);
      expect(w.findAll("[data-test='plan-angle']"), s).toHaveLength(4);
    }
  });
});

describe("the drawer — Approve is its primary action while the plan waits for review", () => {
  it("Approve sits in the footer with the campaign's other actions, and names the version on screen", async () => {
    const w = drawer();
    expect(w.find("[data-test='move-replan']").exists()).toBe(true);
    await w.get("[data-test='plan-approve']").trigger("click");
    await flushPromises();
    expect(api.calls).toEqual([{ path: `/api/ads/campaigns/${ID}/plan/approval`, body: { plan_id: PLAN_ID } }]);
    expect(toasts.success).toEqual(["Plan approved. The ads are being made from it"]);
  });

  it("is offered only in plan review, only to someone who manages recruiting, and only when there is a plan to name", () => {
    for (const s of CAMPAIGN_STATES.filter((x) => x !== "plan_review")) expect(drawer(s).find("[data-test='plan-approve']").exists(), s).toBe(false);
    who.manages = false;
    expect(drawer().find("[data-test='plan-approve']").exists()).toBe(false);
    who.manages = true;
    state.read = { plan: null, concepts: [], formats: [] };
    expect(drawer().find("[data-test='plan-approve']").exists()).toBe(false);
  });

  it("the drawer asks for no plan either while the campaign is still being planned", () => {
    drawer("planning");
    expect(state.enabled.length).toBeGreaterThan(0);
    expect(state.enabled.every((e) => e === false)).toBe(true);
    state.enabled = [];
    drawer("plan_review");
    expect(state.enabled.every((e) => e === true)).toBe(true);
  });

  it("is held back while an edit is open, so an unsaved edit is never approved around, and returns on Cancel", async () => {
    const w = drawer();
    await w.get("[data-test='plan-edit']").trigger("click");
    expect(w.get("[data-test='plan-approve']").attributes("disabled")).toBeDefined();
    await w.get("[data-test='plan-edit-cancel']").trigger("click");
    expect(w.get("[data-test='plan-approve']").attributes("disabled")).toBeUndefined();
  });

  it("an approval the door refuses says so and the plan stays", async () => {
    api.failNext = { error: { code: "plan_moved", message: "The plan changed while you were looking. Reload to read the newest version." } };
    const w = drawer();
    await w.get("[data-test='plan-approve']").trigger("click");
    await flushPromises();
    expect(toasts.error).toEqual(["That did not go through"]);
    expect(w.find("[data-test='plan-approve']").exists()).toBe(true);
  });
});

describe("AdsCampaignPlan — editing", () => {
  it("an edit is sent whole, on the version that was open, with the facts each idea cites unchanged", async () => {
    const w = show();
    await w.get("[data-test='plan-edit']").trigger("click");
    await w.get("[data-test='plan-edit-audience']").setValue("Regional flatbed drivers who are tired of unpredictable weeks away from home.");
    await w.get("[data-test='plan-edit-concept-0']").setValue("pay_first+cab_pov");
    await w.get("[data-test='plan-edit-save']").trigger("click");
    await flushPromises();
    const want = plan();
    want.audience = "Regional flatbed drivers who are tired of unpredictable weeks away from home.";
    want.angles[0]!.scene_family = "cab_pov";
    expect(api.calls).toEqual([{ path: `/api/ads/campaigns/${ID}/plan/versions`, body: { based_on_version: 1, plan: want } }]);
    expect(w.find("[data-test='plan-editor']").exists()).toBe(false);
    expect(toasts.success).toEqual(["Plan saved as a new version"]);
  });

  it("a text the contract would refuse marks its field and holds Save back, so nothing is sent", async () => {
    const w = show();
    await w.get("[data-test='plan-edit']").trigger("click");
    await w.get("[data-test='plan-edit-idea-1']").setValue("x".repeat(2000));
    expect(w.get("[data-test='plan-edit-angle-1']").text()).toContain("This is too long. Shorten it.");
    expect(w.get("[data-test='plan-edit-save']").attributes("disabled")).toBeDefined();
    await w.get("[data-test='plan-edit-save']").trigger("click");
    expect(api.calls).toEqual([]);
  });

  it("the door's refusal is listed in sentences and the editor stays open with what was typed", async () => {
    api.failNext = { error: { code: "plan_refused", message: "This plan cannot be saved. Change what is marked below." }, detail: { findings: [{ kind: "claim", where: "audience", finding: "money_not_in_brief", text: "$0.80" }], off_schema: null } };
    const w = show();
    await w.get("[data-test='plan-edit']").trigger("click");
    await w.get("[data-test='plan-edit-audience']").setValue("Regional flatbed drivers who want $0.80 a mile and a steady week.");
    await w.get("[data-test='plan-edit-save']").trigger("click");
    await flushPromises();
    expect(w.get("[data-test='plan-refusal']").text()).toContain('Who the ads speak to names pay the opening does not offer ("$0.80").');
    expect((w.get("[data-test='plan-edit-audience']").element as HTMLTextAreaElement).value).toContain("$0.80");
    expect(toasts.error).toEqual(["The plan was not saved"]);
  });

  it("an idea can be removed down to three and no further; Cancel discards the edit", async () => {
    const w = show();
    await w.get("[data-test='plan-edit']").trigger("click");
    await w.get("[data-test='plan-edit-remove-3']").trigger("click");
    expect(w.findAll("fieldset")).toHaveLength(3);
    expect(w.find("[data-test='plan-edit-remove-0']").exists()).toBe(false);
    await w.get("[data-test='plan-edit-cancel']").trigger("click");
    expect(w.findAll("[data-test='plan-angle']")).toHaveLength(4);
    expect(api.calls).toEqual([]);
  });
});

describe("the format of an idea — shown and offered only where the campaign has more than one", () => {
  const withVideo = () => { state.read = { plan: view({ plan: { ...plan(), angles: plan().angles.map((a, i) => (i === 1 ? { ...a, format: "motion" as const } : a)) } }), concepts: CONCEPTS, formats: ["still", "motion"] }; };

  it("a campaign that can only be made as a still says nothing about format on any idea, reading or editing", async () => {
    const w = show();
    expect(w.findAll("[data-test='plan-format']")).toHaveLength(0);
    await w.get("[data-test='plan-edit']").trigger("click");
    expect(w.find("[data-test='plan-edit-format-0']").exists()).toBe(false);
  });

  it("a campaign that can make a video says how each idea is made", () => {
    withVideo();
    expect(show().findAll("[data-test='plan-format']").map((b) => b.text())).toEqual(["Made as: Still image", "Made as: Short video", "Made as: Still image", "Made as: Still image"]);
  });

  it("the editor offers the campaign's formats, and the chosen one is what is saved", async () => {
    withVideo();
    const w = show();
    await w.get("[data-test='plan-edit']").trigger("click");
    expect(formatOptions(["still", "motion"], "still")).toEqual([{ value: "still", label: "Still image" }, { value: "motion", label: "Short video" }]);
    await w.get("[data-test='plan-edit-format-0']").setValue("motion");
    await w.get("[data-test='plan-edit-save']").trigger("click");
    await flushPromises();
    const sent = api.calls.at(-1)!.body as { plan: CampaignPlan };
    expect(sent.plan.angles.map((a) => a.format)).toEqual(["motion", "motion", "still", "still"]);
  });

  it("an idea in a format the campaign can no longer make is shown and offered as such, never silently changed", () => {
    expect(showsFormat(["still"], { format: "motion" })).toBe(true);
    expect(showsFormat(["still"], { format: "still" })).toBe(false);
    // An API that does not answer `formats` yet: nothing is known, so nothing is said.
    expect(showsFormat([], { format: "still" })).toBe(false);
    expect(formatOptions(["still"], "motion")).toEqual([{ value: "motion", label: "Short video (cannot be made for this campaign)" }, { value: "still", label: "Still image" }]);
    const a = angle({});
    setFormat(a, "nonsense");
    expect(a.format).toBe("still");
    expect(formatLabel("carousel")).toBe("carousel");
  });
});
