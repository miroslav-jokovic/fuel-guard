import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import DrugTestPanel from "@/features/recruitment/DrugTestPanel.vue";

/**
 * The drug test's appointment (D-AW6, APPLICATION-FLOW-V2-PLAN §6.3, C2b3). ⚠ Asserts the BODY the API
 * receives, for `TravelPanel.test.ts`'s reason: the server reads the window on the CARRIER's clock, so a
 * panel that posted a browser instant is only visible here.
 */
const state = vi.hoisted(() => ({
  appointments: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { appointment: { id: "a-new" } } };
    }
    return { ok: true, data: { appointments: state.appointments, timeZone: "America/Chicago" } };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = (done = false) =>
  mount(DrugTestPanel, { props: { driverId: "d1", done }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text));

const LIVE = {
  id: "a-1", siteName: "Concentra Joliet", siteAddress: "1051 Essington Rd", sitePhone: null,
  windowStart: "2026-10-01T13:00:00.000Z", windowEnd: null, donorReference: "REG-448812",
  arrangedAt: "2026-09-26T18:00:00Z", sentToDriverAt: null, cancelledAt: null,
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.appointments = [];
  state.requests = [];
  state.canManage = true;
});

describe("arranging", () => {
  it("posts the site and the wall times as typed, for the server to read on the carrier's clock", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("Central");
    const [site, address] = w.findAll("input");
    await site!.setValue("Concentra Joliet");
    await address!.setValue("1051 Essington Rd, Joliet, IL");
    const [from] = w.findAllComponents({ name: "AppDateTimeField" });
    from!.vm.$emit("update:modelValue", "2026-10-01T08:00");
    await settle(w);
    await button(w, "Record the appointment")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/applicants/d1/drug-test-appointments",
      method: "POST",
      body: {
        site_name: "Concentra Joliet", site_address: "1051 Essington Rd, Joliet, IL", site_phone: null,
        window_start: "2026-10-01T08:00", window_end: null, donor_reference: null,
      },
    }]);
  });

  it("offers no form to somebody who may only view the section", async () => {
    state.canManage = false;
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Record the appointment")).toBeUndefined();
  });

  /** The result is the fact; once it is in there is nothing left to arrange. */
  it("shows nothing once the result is recorded and no appointment was made", async () => {
    const w = mountPanel(true);
    await settle(w);
    expect(w.text()).toBe("");
  });
});

describe("an arranged appointment", () => {
  it("shows it on the carrier's clock, and cancels it by its id", async () => {
    state.appointments = [LIVE];
    const w = mountPanel();
    await settle(w);
    // 13:00Z is 08:00 in Chicago on 2026-10-01 — whatever zone the test machine is in.
    expect(w.text()).toContain("10/01/2026 8:00");
    expect(w.text()).toContain("REG-448812");
    await button(w, "Cancel it")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/applicants/d1/drug-test-appointments/a-1", method: "DELETE", body: undefined,
    }]);
  });
});
