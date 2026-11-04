import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { useConfirmStore } from "@silvicom/ui";
import { CARRIER_QUESTIONS_LIVE_MAX, type CarrierQuestion } from "@silvicom/shared";
import CarrierQuestionsEditor from "@/features/recruitment/CarrierQuestionsEditor.vue";

/**
 * Settings → Recruiting's "Your own questions" (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3 D-CQ1, CQ2): the list,
 * adding one with the contract's shape, changing only what may change, reordering, removing behind a confirm,
 * the 20-question limit — every write asserted by the request it makes.
 */
const state = vi.hoisted(() => ({
  questions: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { question: { ...(state.questions[0] as object) } } };
    }
    if (url.endsWith("/carrier-questions")) return { ok: true, data: { questions: state.questions } };
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

const Q = (id: string, over: Partial<CarrierQuestion> = {}): CarrierQuestion => ({
  id, wording: id === "q1" ? "Do you own a pet?" : "Preferred lane", hint: null, kind: "boolean", choices: null,
  required: false, position: 0, created_at: "2026-11-04T00:00:00Z", retired_at: null, ...over,
});

beforeEach(() => {
  setActivePinia(createPinia());
  state.questions = [
    Q("q1", { required: true, hint: "Dogs and cats count" }),
    Q("q2", { kind: "select", choices: ["East", "West"], position: 0 }),
  ];
  state.requests = [];
  state.canManage = true;
});

const mountEditor = () => mount(CarrierQuestionsEditor, { global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, label: string, row = 0) =>
  w.findAll('[data-testid="carrier-question"]')[row]!.findAll("button").find((b) => b.text() === label)!;

describe("Settings → Recruiting: your own questions", () => {
  it("lists each question with its kind, its choices, whether it is required, and its hint — and the count of 20", async () => {
    const w = mountEditor();
    await settle(w);
    const rows = w.findAll('[data-testid="carrier-question"]').map((r) => r.text());
    expect(rows[0]).toContain("Do you own a pet?");
    expect(rows[0]).toContain("Yes or no");
    expect(rows[0]).toContain("Required");
    expect(rows[0]).toContain("Hint: Dogs and cats count");
    expect(rows[1]).toContain("One of a list · East / West");
    expect(w.get('[data-testid="question-count"]').text()).toBe(`2 of ${CARRIER_QUESTIONS_LIVE_MAX}`);
    expect(w.get('[data-testid="frozen-note"]').text()).toContain("remove it and add a new one");
  });

  it("adds a one-of-a-list question with its choices, one per line, in the contract's shape", async () => {
    const w = mountEditor();
    await settle(w);
    const add = w.get('[data-testid="add-question"]');
    await add.findAll("input")[0]!.setValue("Which shift?");
    await add.get("select").setValue("select");
    await settle(w);
    await w.get('[data-testid="add-question"] textarea').setValue("Days\n\n  Nights  \n");
    await w.findAll('[data-testid="add-question"] input[type=checkbox]').at(-1)!.setValue(true);
    await w.findAll('[data-testid="add-question"] button').at(-1)!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/carrier-questions", method: "POST",
      body: { wording: "Which shift?", hint: null, kind: "select", choices: ["Days", "Nights"], required: true },
    }]);
  });

  it("refuses a list with one choice before any request", async () => {
    const w = mountEditor();
    await settle(w);
    await w.get('[data-testid="add-question"] input').setValue("Which shift?");
    await w.get('[data-testid="add-question"] select').setValue("select");
    await settle(w);
    await w.get('[data-testid="add-question"] textarea').setValue("Days");
    await settle(w);
    const save = w.findAll('[data-testid="add-question"] button').at(-1)!;
    expect(save.attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="add-question"]').text()).toContain("Give at least 2 choices.");
  });

  it("changes required, and the hint, and nothing else", async () => {
    const w = mountEditor();
    await settle(w);
    await w.findAll('[data-testid="carrier-question"]')[0]!.get("input[type=checkbox]").setValue(false);
    await settle(w);
    await button(w, "Hint").trigger("click");
    await settle(w);
    await w.get('[data-testid="hint-editor"] input').setValue("");
    await w.get('[data-testid="hint-editor"]').findAll("button").find((b) => b.text() === "Save")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([
      { url: "/api/recruitment/carrier-questions/q1", method: "PATCH", body: { required: false } },
      { url: "/api/recruitment/carrier-questions/q1", method: "PATCH", body: { hint: null } },
    ]);
  });

  it("moves a question down by renumbering the list, writing only the places that changed", async () => {
    // Both saved at 0 — a tie a swap of positions could not break.
    state.questions = [Q("q1", { position: 0 }), Q("q2", { position: 0 })];
    const w = mountEditor();
    await settle(w);
    expect(button(w, "Up").attributes("disabled")).toBeDefined();
    await button(w, "Down").trigger("click");
    await settle(w);
    expect(state.requests).toEqual([
      { url: "/api/recruitment/carrier-questions/q1", method: "PATCH", body: { position: 1 } },
    ]);
  });

  it("removes a question by retiring it, only after the confirm", async () => {
    const w = mountEditor();
    await settle(w);
    await button(w, "Remove").trigger("click");
    await settle(w);
    useConfirmStore().answer(false);
    await settle(w);
    expect(state.requests).toEqual([]);
    await button(w, "Remove").trigger("click");
    await settle(w);
    useConfirmStore().answer(true);
    await settle(w);
    expect(state.requests).toEqual([{ url: "/api/recruitment/carrier-questions/q1", method: "PATCH", body: { retire: true } }]);
  });

  it("says the list is full at 20 and offers no add form", async () => {
    state.questions = Array.from({ length: CARRIER_QUESTIONS_LIVE_MAX }, (_, i) => Q(`q${i + 1}`, { position: i }));
    const w = mountEditor();
    await settle(w);
    expect(w.find('[data-testid="questions-full"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="add-question"] input')).toHaveLength(0);
  });

  it("shows no add form or controls to a role that may only look", async () => {
    state.canManage = false;
    const w = mountEditor();
    await settle(w);
    expect(w.find('[data-testid="add-question"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="carrier-question"] button')).toHaveLength(0);
  });
});
