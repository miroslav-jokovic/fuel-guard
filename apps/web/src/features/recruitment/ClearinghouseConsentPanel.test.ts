import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import ClearinghouseConsentPanel from "@/features/recruitment/ClearinghouseConsentPanel.vue";

/**
 * The driver's portal consent (D-AW5, C2b3). ⚠ A testing record (§382.401(a)): the role test is the
 * panel's first property, and the drug-test order is a warning, never a refusal.
 */
const state = vi.hoisted(() => ({
  drugTest: "waiting_on_them" as string,
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canRead: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { recordId: "r-1", created: true } };
    }
    return { ok: true, data: { checklist: { steps: [{ key: "drug_test", state: state.drugTest }] } } };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ canReadKind: () => state.canRead, can: () => true }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = (consented = false) =>
  mount(ClearinghouseConsentPanel, { props: { driverId: "d1", consented, done: false }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text));

beforeEach(() => {
  setActivePinia(createPinia());
  state.drugTest = "waiting_on_them";
  state.requests = [];
  state.canRead = true;
});

describe("the portal consent", () => {
  it("posts the day the portal shows it", async () => {
    const w = mountPanel();
    await settle(w);
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-09-22");
    await settle(w);
    await button(w, "Record the consent")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/applicants/d1/clearinghouse-portal-consent", method: "POST", body: { occurred_on: "2026-09-22" },
    }]);
  });

  it("tells a role that may not read testing records who records it", async () => {
    state.canRead = false;
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Record the consent")).toBeUndefined();
    expect(w.text()).toContain("A safety manager or an admin records it");
  });

  it("says the query is the office's once the consent is on file", async () => {
    const w = mountPanel(true);
    await settle(w);
    expect(button(w, "Record the consent")).toBeUndefined();
    expect(w.text()).toContain("the query is yours to run");
  });

  it("warns — and only warns — while the drug test result is not in", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("The drug test result is not in yet");
    state.drugTest = "done";
    const after = mountPanel();
    await settle(after);
    expect(after.text()).not.toContain("The drug test result is not in yet");
  });
});
