import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import TravelPanel from "@/features/recruitment/TravelPanel.vue";

/**
 * The trip's screen (D-AW7, APPLICATION-FLOW-V2-PLAN §7, C2b2). ⚠ Asserts the BODY the API receives:
 * the server converts the times on the CARRIER's clock and refuses an unready applicant, so a panel
 * that posted an instant from the browser — or offered the form to a blocked row — is only visible here.
 */
const state = vi.hoisted(() => ({
  trips: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { trip: { id: "t-new" } } };
    }
    return { ok: true, data: { trips: state.trips, timeZone: "America/Chicago" } };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = (blocked = false) =>
  mount(TravelPanel, { props: { driverId: "d1", blocked }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text));

const LIVE = {
  id: "t-1", mode: "air", departAt: "2026-10-05T13:30:00.000Z", arriveAt: "2026-10-05T16:10:00.000Z",
  confirmationRef: "QX7K2P", bookedAt: "2026-09-26T18:00:00Z", cancelledAt: null,
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.trips = [];
  state.requests = [];
  state.canManage = true;
});

describe("booking", () => {
  it("posts the wall times as typed, for the server to read on the carrier's clock", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("Central");
    const [depart, arrive] = w.findAllComponents({ name: "AppDateTimeField" });
    depart!.vm.$emit("update:modelValue", "2026-10-05T08:30");
    arrive!.vm.$emit("update:modelValue", "2026-10-05T11:10");
    await settle(w);
    await button(w, "Record the trip")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/applicants/d1/travel",
      method: "POST",
      body: { mode: "air", depart_at: "2026-10-05T08:30", arrive_at: "2026-10-05T11:10", confirmation_ref: null },
    }]);
  });

  /** Q-HM5: the API refuses while a step before travel is open, so the form is not offered at all. */
  it("offers no form while the row is blocked, and says why", async () => {
    const w = mountPanel(true);
    await settle(w);
    expect(button(w, "Record the trip")).toBeUndefined();
    expect(w.text()).toContain("Travel is booked once everything before the office day is done.");
  });

  it("offers no form to somebody who may only view the section", async () => {
    state.canManage = false;
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Record the trip")).toBeUndefined();
  });
});

describe("a booked trip", () => {
  it("shows it on the carrier's clock, and cancels it by its id", async () => {
    state.trips = [LIVE];
    const w = mountPanel();
    await settle(w);
    // 13:30Z is 08:30 in Chicago on 2026-10-05 — whatever zone the test machine is in.
    expect(w.text()).toContain("10/05/2026 8:30");
    expect(w.text()).toContain("QX7K2P");
    expect(button(w, "Record the trip")).toBeUndefined();
    await button(w, "Cancel it")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{ url: "/api/recruitment/applicants/d1/travel/t-1", method: "DELETE", body: undefined }]);
  });
});
