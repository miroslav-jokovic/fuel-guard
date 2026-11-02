import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { AppCheckbox } from "@silvicom/ui";
import ApplicationFormSettings from "@/features/recruitment/ApplicationFormSettings.vue";

/**
 * Settings → Recruiting's "The application form" (HIRING-WORKFLOW-AUDIT §11 S2): the two lists, each
 * write asserted by the request it makes.
 */
const state = vi.hoisted(() => ({
  settings: null as unknown,
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: state.settings };
    }
    if (url.endsWith("/settings")) return { ok: true, data: state.settings };
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
const BASE = { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48, handbook_blocks_hire: false, videos_block_hire: false, hidden_hiring_steps: [] };
const view = (over: Record<string, unknown> = {}) => ({
  settings: { ...BASE, required_questions: null, offered_document_slots: null, ...over }, isDefault: false, updatedAt: "2026-11-02T00:00:00Z",
});
const mountIt = () => mount(ApplicationFormSettings, { global: { plugins: [VueQueryPlugin] } });
const box = (w: ReturnType<typeof mount>, list: string, label: string) =>
  w.find(`[data-testid="${list}"]`).findAllComponents(AppCheckbox).find((c: { props: (k: string) => unknown }) => c.props("label") === label)!;
const lastBody = () => state.requests.at(-1)!.body as Record<string, unknown>;

beforeEach(() => {
  setActivePinia(createPinia());
  state.settings = view();
  state.requests = [];
  state.canManage = true;
});

describe("the questions an applicant must answer", () => {
  it("shows the standard seven ticked while the carrier has not chosen, and never 'If so, when?'", async () => {
    const w = mountIt();
    await settle(w);
    const boxes = w.find('[data-testid="required-questions"]').findAllComponents(AppCheckbox);
    expect(boxes.filter((b: { props: (k: string) => unknown }) => b.props("modelValue")).length).toBe(7);
    expect(boxes.map((b: { props: (k: string) => unknown }) => b.props("label"))).not.toContain("If so, when?");
    expect(boxes).toHaveLength(10);
    expect(w.find('[data-testid="questions-standard"]').exists()).toBe(false);
  });

  it("writes the whole list, in the form's order, when one is ticked", async () => {
    const w = mountIt();
    await settle(w);
    box(w, "required-questions", "Three personal references").vm.$emit("update:modelValue", true);
    await settle(w);
    expect(state.requests.at(-1)).toMatchObject({ method: "PUT" });
    expect(lastBody().required_questions).toEqual(
      ["position", "applying_as", "heard_from", "legally_work", "proof_of_age", "may_contact_employers", "education", "references"],
    );
    // The rest of the settings travel unchanged, so the save keeps them.
    expect(lastBody()).toMatchObject({ invite_ttl_days: 14, hidden_hiring_steps: [] });
  });

  it("writes the list in the form's order, not the order the boxes were ticked", async () => {
    state.settings = view({ required_questions: ["references"] });
    const w = mountIt();
    await settle(w);
    box(w, "required-questions", "Position you are applying for").vm.$emit("update:modelValue", true);
    await settle(w);
    expect(lastBody().required_questions).toEqual(["position", "references"]);
  });

  it("writes one less when one is unticked", async () => {
    const w = mountIt();
    await settle(w);
    box(w, "required-questions", "How did you hear about this company?").vm.$emit("update:modelValue", false);
    await settle(w);
    expect(lastBody().required_questions).not.toContain("heard_from");
    expect(lastBody().required_questions).toHaveLength(6);
  });

  it("'Use the standard set' writes null", async () => {
    state.settings = view({ required_questions: ["position"] });
    const w = mountIt();
    await settle(w);
    await w.find('[data-testid="questions-standard"]').trigger("click");
    await settle(w);
    expect(lastBody().required_questions).toBeNull();
  });
});

describe("the documents the application asks for", () => {
  it("lists only what may be withheld, and names the licence and the medical card as always asked", async () => {
    const w = mountIt();
    await settle(w);
    const labels = w.find('[data-testid="offered-documents"]').findAllComponents(AppCheckbox).map((b: { props: (k: string) => unknown }) => b.props("label"));
    expect(labels).toContain("Passport");
    expect(labels).not.toContain("Front of your licence");
    expect(labels).not.toContain("Medical examiner's certificate");
    expect(w.find('[data-testid="offered-documents"]').text()).toContain("Always asked: Front of your licence, Back of your licence, Medical examiner's certificate");
  });

  it("writes the slots still asked for when one is unticked, and null for 'Ask for every document'", async () => {
    const w = mountIt();
    await settle(w);
    box(w, "offered-documents", "Passport").vm.$emit("update:modelValue", false);
    await settle(w);
    expect(lastBody().offered_document_slots).not.toContain("passport");
    expect(lastBody().offered_document_slots).toContain("twic");

    state.settings = view({ offered_document_slots: ["twic"] });
    const w2 = mountIt();
    await settle(w2);
    await w2.find('[data-testid="documents-standard"]').trigger("click");
    await settle(w2);
    expect(lastBody().offered_document_slots).toBeNull();
  });
});

describe("who may change them", () => {
  it("shows the lists read-only without recruitment manage, and writes nothing", async () => {
    state.canManage = false;
    state.settings = view({ required_questions: ["position"] });
    const w = mountIt();
    await settle(w);
    expect(box(w, "required-questions", "Position you are applying for").props("disabled")).toBe(true);
    expect(w.find('[data-testid="questions-standard"]').exists()).toBe(false);
    expect(state.requests).toEqual([]);
  });
});
