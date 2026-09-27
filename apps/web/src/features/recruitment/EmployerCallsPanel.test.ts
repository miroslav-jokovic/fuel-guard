import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import EmployerCallsPanel from "@/features/recruitment/EmployerCallsPanel.vue";

/**
 * The office's calls to previous employers before filing (D-AW8, C2b3). ⚠ Asserts the BODY the API
 * receives: the call is filed under the draft's KEY and nothing else, and a corrected answer carries
 * what was said — the two things the server refuses, visible here before it does.
 */
const KEY = "40000000-0000-4000-8000-00000000000a";

const state = vi.hoisted(() => ({
  list: null as unknown,
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { call: { id: "c-new" } } };
    }
    return { ok: true, data: state.list };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = () => mount(EmployerCallsPanel, { props: { driverId: "d1" }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text));

const LIST = (filed = false) => ({
  employers: [
    { key: KEY, name: "Kowlage Haulage", startedOn: "2023-01-01", endedOn: null, phone: "815-555-0100", dotRegulated: true },
    { key: null, name: "Rivergate Freight", startedOn: null, endedOn: null, phone: null, dotRegulated: null },
  ],
  calls: [],
  filed,
  timeZone: "America/Chicago",
});

beforeEach(() => {
  setActivePinia(createPinia());
  state.list = LIST();
  state.requests = [];
  state.canManage = true;
});

describe("recording a call", () => {
  it("posts it under the employer's key, with a corrected answer's words", async () => {
    const w = mountPanel();
    await settle(w);
    // One button: the keyless entry says why it cannot take a call instead.
    expect(w.findAll("button").filter((b) => b.text() === "Record a call")).toHaveLength(1);
    expect(w.text()).toContain("Entered before employers carried a reference");

    await button(w, "Record a call")!.trigger("click");
    await settle(w);
    await w.findAll("input")[0]!.setValue("Dana Whitfield");
    w.findAllComponents({ name: "AppDateTimeField" })[0]!.vm.$emit("update:modelValue", "2026-09-24T10:15");
    // Reason for leaving: the third question.
    w.findAllComponents({ name: "AppSelect" })[2]!.vm.$emit("update:modelValue", "corrected");
    await settle(w);
    expect(button(w, "Record the call")!.attributes("disabled")).toBeDefined();
    const inputs = w.findAll("input");
    await inputs[inputs.length - 1]!.setValue("Laid off");
    await settle(w);
    await button(w, "Record the call")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/applicants/d1/employer-calls",
      method: "POST",
      body: {
        employer_key: KEY,
        answered_by: "Dana Whitfield",
        called_at: "2026-09-24T10:15",
        outcomes: { dates: "confirmed", position: "confirmed", reason: "corrected", cmv: "confirmed", dot_tested: "confirmed" },
        corrections: { reason: "Laid off" },
      },
    }]);
  });

  it("offers no call once the application is filed, and says where contact goes instead", async () => {
    state.list = LIST(true);
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Record a call")).toBeUndefined();
    expect(w.text()).toContain("on the inquiry list below");
  });

  it("offers no call to somebody who may only view the section", async () => {
    state.canManage = false;
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Record a call")).toBeUndefined();
  });
});
