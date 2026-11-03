import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { useConfirmStore } from "@silvicom/ui";
import {
  APPLICATION_RELEASE_ORDER,
  HIDEABLE_ROW_STEPS,
  hiringChecklist,
  packetDriverMarkCount,
  type CarrierChecklistRow,
  type CarrierStep,
  type HiringChecklistInputs,
} from "@silvicom/shared";
import CarrierStepsEditor from "@/features/recruitment/CarrierStepsEditor.vue";
import CarrierStepDrawer from "@/features/recruitment/CarrierStepDrawer.vue";
import HiringChecklistCard from "@/features/recruitment/HiringChecklistCard.vue";

/**
 * The carrier's own hiring steps on screen (HIRING-WORKFLOW-AUDIT §10 CE2): Settings → Recruiting's
 * editor, the rows on the checklist (laid out from the REAL fold, `HiringChecklistCard.test.ts`'s rule),
 * and the step's drawer — every write asserted by the request it makes.
 */
const state = vi.hoisted(() => ({
  steps: [] as unknown[],
  settings: null as unknown,
  documents: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      if (url.includes("/settings")) return { ok: true, data: state.settings };
      if (url.includes("/applicants/")) return { ok: true, data: { latest: { stepId: "s1", act: "done", at: "2026-11-02T10:00:00Z", byName: "Dana", note: null, documentId: null } } };
      return { ok: true, data: { step: { ...(state.steps[0] as object) } } };
    }
    if (url.endsWith("/carrier-steps")) return { ok: true, data: { steps: state.steps } };
    if (url.endsWith("/settings")) return { ok: true, data: state.settings };
    if (url.endsWith("/documents")) return { ok: true, data: { documents: state.documents } };
    return { ok: false, error: { message: `unexpected ${url}` } };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const STEP = (id: string, over: Partial<CarrierStep> = {}): CarrierStep => ({
  id, label: id === "s1" ? "Fuel card issued" : "Hair test", instructions: null, after_step: "road_test", position: 0,
  owes: "us", proof: "tick", blocks_hire: false, created_at: "2026-11-01T00:00:00Z", retired_at: null, ...over,
});
const SETTINGS = {
  settings: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48, handbook_blocks_hire: false, videos_block_hire: false, hidden_hiring_steps: ["psp"] },
  isDefault: false, updatedAt: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.steps = [STEP("s1", { blocks_hire: true }), STEP("s2", { after_step: "drug_test", proof: "document" })];
  state.settings = SETTINGS;
  state.documents = [];
  state.requests = [];
  state.canManage = true;
});

describe("Settings → Recruiting: your hiring steps", () => {
  const mountEditor = () => mount(CarrierStepsEditor, { global: { plugins: [VueQueryPlugin] } });

  it("lists the carrier's steps with where they go, what proves them and whether the hire waits", async () => {
    const w = mountEditor();
    await settle(w);
    const rows = w.findAll('[data-testid="carrier-step"]').map((r) => r.text());
    expect(rows[0]).toContain("Fuel card issued");
    expect(rows[0]).toContain("After “Road test”");
    expect(rows[0]).toContain("Hire waits for it");
    expect(rows[1]).toContain("A document on file");
  });

  it("adds a step with the contract's shape", async () => {
    const w = mountEditor();
    await settle(w);
    await w.get('[data-testid="add-step"] input').setValue("Tablet issued");
    await w.findAll('[data-testid="add-step"] button').at(-1)!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/carrier-steps", method: "POST",
      body: { label: "Tablet issued", instructions: null, afterStep: "road_test", owes: "us", proof: "tick", blocksHire: false },
    }]);
  });

  it("removes a step by retiring it, only after the confirm", async () => {
    const w = mountEditor();
    await settle(w);
    const remove = w.findAll("button").find((b) => b.text() === "Remove")!;
    await remove.trigger("click");
    await settle(w);
    useConfirmStore().answer(true);
    await settle(w);
    expect(state.requests).toEqual([{ url: "/api/recruitment/carrier-steps/s1", method: "PATCH", body: { retire: true } }]);
  });

  it("declining the confirm removes nothing", async () => {
    const w = mountEditor();
    await settle(w);
    await w.findAll("button").find((b) => b.text() === "Remove")!.trigger("click");
    await settle(w);
    useConfirmStore().answer(false);
    await settle(w);
    expect(state.requests).toEqual([]);
  });

  it("offers only the hideable built-in steps, ticked when run, and saves the whole settings with the change", async () => {
    const w = mountEditor();
    await settle(w);
    const boxes = w.findAll('[data-testid="built-in-steps"] input[type=checkbox]');
    // §14 D-OF1: rows only — the live orientation day is off the list, so it is not offered.
    expect(boxes).toHaveLength(HIDEABLE_ROW_STEPS.length);
    expect(w.get('[data-testid="built-in-steps"]').text()).toContain("Drug test result");
    // PSP is hidden in the fixture, so its box (the first hideable) is unticked; untick the trip.
    expect((boxes[0]!.element as HTMLInputElement).checked).toBe(false);
    await boxes[HIDEABLE_ROW_STEPS.indexOf("travel_booked")]!.setValue(false);
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/settings", method: "PUT",
      body: { ...SETTINGS.settings, hidden_hiring_steps: ["psp", "travel_booked"] },
    }]);
  });

  it("shows no add form or switches to a role that may only look", async () => {
    state.canManage = false;
    const w = mountEditor();
    await settle(w);
    expect(w.find('[data-testid="add-step"]').exists()).toBe(false);
    expect(w.findAll("button").some((b) => b.text() === "Remove")).toBe(false);
  });
});

describe("the checklist lays the carrier's rows out where the fold put them", () => {
  const ALL = APPLICATION_RELEASE_ORDER.map((purpose) => ({ id: purpose, purpose, accepted_at: "2026-09-01T00:00:00Z", revokes: null }));
  const input = (over: Partial<HiringChecklistInputs>): HiringChecklistInputs => ({
    invitedAt: "2026-09-01T00:00:00Z", intake: { v2: true, completedAt: "2026-09-01T06:00:00Z" },
    phases: { applicationSentAt: "2026-09-01T12:00:00Z", reviewRequestedAt: null, approvedAt: "2026-09-03T00:00:00Z", signingOpenedAt: null, submittedAt: null },
    authorizations: ALL, qualificationKinds: ["mvr", "drug_test"], packetMarks: packetDriverMarkCount(null) - 1, ...over,
  });

  it("each carrier row sits right after its built-in step, and a hidden built-in is gone", async () => {
    const checklist = hiringChecklist(input({
      hiddenSteps: ["psp"],
      carrierSteps: { steps: [STEP("s1"), STEP("s2", { after_step: "drug_test" })], latest: [] },
    }));
    const w = mount(HiringChecklistCard, { props: { driverId: "d1", checklist, loading: false, error: null }, global: { stubs: { RouterLink: true } } });
    const labels = w.findAll("li").map((li) => li.find("button").text().split("\n")[0]!.trim().split(/\s{2,}/)[0]!);
    expect(labels.some((l) => l.startsWith("PSP"))).toBe(false);
    const at = (needle: string) => labels.findIndex((l) => l.startsWith(needle));
    expect(at("Hair test")).toBe(at("Drug test result") + 1);
    expect(at("Fuel card issued")).toBe(at("Road test") + 1);
    expect(w.findAll('[data-testid="carrier-step-row"]')).toHaveLength(2);
    expect(w.text()).toContain(`of ${checklist.total} hiring steps`);
  });

  // §14 D-OF2: a step stored after the medical card (a half drawn inside the driving-record row) shows
  // right after that row — never lost because its anchor is no longer a row of its own.
  it("a carrier row placed after a half of a merged row sits after that row", async () => {
    const checklist = hiringChecklist(input({
      carrierSteps: { steps: [STEP("s2", { after_step: "medical_certificate" })], latest: [] },
    }));
    const w = mount(HiringChecklistCard, { props: { driverId: "d1", checklist, loading: false, error: null }, global: { stubs: { RouterLink: true } } });
    const labels = w.findAll("li").map((li) => li.find("button").text().split("\n")[0]!.trim().split(/\s{2,}/)[0]!);
    expect(labels.findIndex((l) => l.startsWith("Hair test"))).toBe(labels.findIndex((l) => l.startsWith("Driving record")) + 1);
  });

  it("opening a carrier row asks the page for that row", async () => {
    const checklist = hiringChecklist(input({ carrierSteps: { steps: [STEP("s1")], latest: [] } }));
    const w = mount(HiringChecklistCard, { props: { driverId: "d1", checklist, loading: false, error: null }, global: { stubs: { RouterLink: true } } });
    await w.get('[data-testid="carrier-step-row"] button').trigger("click");
    expect((w.emitted("openCarrier")?.[0]?.[0] as CarrierChecklistRow).id).toBe("s1");
  });
});

describe("the carrier step's drawer", () => {
  const SlideOver = { template: "<div><slot /><slot name='footer' /></div>", props: ["open", "title", "size"] };
  const row = (over: Partial<CarrierChecklistRow> = {}): CarrierChecklistRow => ({
    id: "s1", label: "Fuel card issued", instructions: "At the desk", owes: "us", proof: "tick", blocksHire: true,
    afterStep: "road_test", showAfter: "road_test", state: "waiting_on_us", record: null, ...over,
  });
  const mountDrawer = (step: CarrierChecklistRow) =>
    mount(CarrierStepDrawer, { props: { open: true, driverId: "d1", step }, global: { plugins: [VueQueryPlugin], stubs: { SlideOver } } });
  const press = async (w: ReturnType<typeof mount>, label: string) => {
    await w.findAll("button").find((b) => b.text() === label)!.trigger("click");
    await settle(w);
  };

  it("marks a tick step done with one press, on the applicant's own route", async () => {
    const w = mountDrawer(row());
    await settle(w);
    expect(w.text()).toContain("At the desk");
    expect(w.text()).toContain("the hire waits for it");
    await press(w, "Mark done");
    expect(state.requests).toEqual([{ url: "/api/recruitment/applicants/d1/carrier-steps/s1", method: "POST", body: { act: "done", note: null, documentId: null } }]);
  });

  it("a document step offers only filed papers, and says to add one when there is none", async () => {
    state.documents = [];
    const empty = mountDrawer(row({ proof: "document" }));
    await settle(empty);
    expect(empty.find('[data-testid="carrier-step-no-papers"]').exists()).toBe(true);
    expect(empty.findAll("button").find((b) => b.text() === "Mark done")!.attributes("disabled")).toBeDefined();

    state.documents = [
      { id: "a0000000-0000-4000-8000-000000000001", kind: "training_certificate", at: "2026-11-01T00:00:00Z", staged: false },
      { id: "cap-staged", kind: "other", at: "2026-11-01T00:00:00Z", staged: true },
    ];
    const w = mountDrawer(row({ proof: "document" }));
    await settle(w);
    const options = w.findAll("option").map((o) => o.attributes("value"));
    expect(options).toContain("a0000000-0000-4000-8000-000000000001");
    expect(options).not.toContain("cap-staged");
    await w.get("select").setValue("a0000000-0000-4000-8000-000000000001");
    await settle(w);
    expect(w.findAll("button").find((b) => b.text() === "Mark done")!.attributes("disabled")).toBeUndefined();
    await press(w, "Mark done");
    expect(state.requests.at(-1)!.body).toEqual({ act: "done", note: null, documentId: "a0000000-0000-4000-8000-000000000001" });
  });

  it("taking a done step back asks why before it can be sent", async () => {
    const w = mountDrawer(row({ state: "done", record: { stepId: "s1", act: "done", at: "2026-11-02T00:00:00Z", byName: "Dana", note: null, documentId: null } }));
    await settle(w);
    expect(w.get('[data-testid="carrier-step-done"]').text()).toContain("Done by Dana on 11/02/2026");
    await press(w, "Take it back");
    const send = w.findAll("button").find((b) => b.text() === "Take it back")!;
    expect(send.attributes("disabled")).toBeDefined();
    await w.get("textarea").setValue("Card was for the wrong truck");
    await press(w, "Take it back");
    expect(state.requests.at(-1)!.body).toEqual({ act: "undone", note: "Card was for the wrong truck", documentId: null });
  });

  it("a role that may only look is told who can record it", async () => {
    state.canManage = false;
    const w = mountDrawer(row());
    await settle(w);
    expect(w.text()).toContain("Ask someone who manages recruiting");
    expect(w.findAll("button").some((b) => b.text() === "Mark done")).toBe(false);
  });
});
