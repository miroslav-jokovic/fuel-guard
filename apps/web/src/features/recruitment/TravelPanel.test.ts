import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import TravelPanel from "@/features/recruitment/TravelPanel.vue";
import { apiFetch } from "@/lib/api";

/**
 * The trip's screen (D-AW7, APPLICATION-FLOW-V2-PLAN §7, C2b2). ⚠ Asserts the BODY the API receives:
 * the server converts the times on the CARRIER's clock and refuses an unready applicant, so a panel
 * that posted an instant from the browser — or offered the form to a blocked row — is only visible here.
 */
const state = vi.hoisted(() => ({
  trips: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
  /** §9 P4: the steps before travel still open on the checklist the panel reads. */
  open: [] as string[],
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { trip: { id: "t-new" } } };
    }
    if (url.endsWith("/checklist")) {
      const { TRAVEL_WARNS_ON } = await import("@silvicom/shared");
      return { ok: true, data: { checklist: { steps: TRAVEL_WARNS_ON.map((key) => ({ key, state: state.open.includes(key) ? "waiting_on_us" : "done" })) } } };
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
const mountPanel = (open: string[] = []) => {
  state.open = open;
  return mount(TravelPanel, { props: { driverId: "d1" }, global: { plugins: [VueQueryPlugin] } });
};
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
  it("§9 P4 (G2): offers the form with steps still open, and names them first", async () => {
    const w = mountPanel(["psp", "drug_test"]);
    await settle(w);
    expect(button(w, "Record the trip")).toBeDefined();
    expect(w.get('[data-testid="travel-still-open"]').text()).toContain("Still open: PSP report, Drug test result");
  });

  it("§9 P4: says nothing is open when nothing is", async () => {
    const w = mountPanel([]);
    await settle(w);
    expect(w.find('[data-testid="travel-still-open"]').exists()).toBe(false);
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

/**
 * D-US5: a list of trips that fails says so in a sentence and offers a Retry that asks the API again.
 * Before, the failure was a tinted line with no way back but the browser's reload, which resets
 * everything else the recruiter had open. `retry: false` so the first failure is the one shown.
 */
describe("when the list of trips fails (D-US5)", () => {
  it("says what could not be loaded, and Retry asks the API again", async () => {
    const real = vi.mocked(apiFetch).getMockImplementation()!;
    let failing = true;
    const asked = (): number =>
      vi.mocked(apiFetch).mock.calls.filter(([u, o]) => String(u).includes("/travel") && !(o as { method?: string } | undefined)?.method).length;
    vi.mocked(apiFetch).mockImplementation(((url: string, opts?: { method?: string }) =>
      failing && !opts?.method && url.includes("/travel")
        ? Promise.resolve({ ok: false, status: 500, data: null, error: { message: "The API is down." } })
        : real(url as never, opts as never)) as never);
    try {
      const w = mount(TravelPanel, {
        props: { driverId: "d1", blocked: false },
        global: {
          plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
        },
      });
      await settle(w as never);
      expect(w.text()).toContain("Could not load the trips.");
      const before = asked();
      failing = false;
      await w.findAll("button").find((b) => b.text().trim() === "Retry")!.trigger("click");
      await settle(w as never);
      expect(asked()).toBe(before + 1);
      expect(w.text()).not.toContain("Could not load the trips.");
    } finally {
      vi.mocked(apiFetch).mockImplementation(real);
    }
  });
});
