import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import EmployerCallsPanel from "@/features/recruitment/EmployerCallsPanel.vue";
import { apiFetch } from "@/lib/api";

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
    expect(w.text()).toContain("on the inquiry list once the application is filed");

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

/**
 * D-US5: a list of calls that fails says so in a sentence and offers a Retry that asks the API again.
 * Before, the failure was a tinted line with no way back but the browser's reload, which resets
 * everything else the recruiter had open. `retry: false` so the first failure is the one shown.
 */
describe("when the list of calls fails (D-US5)", () => {
  it("says what could not be loaded, and Retry asks the API again", async () => {
    const real = vi.mocked(apiFetch).getMockImplementation()!;
    let failing = true;
    const asked = (): number =>
      vi.mocked(apiFetch).mock.calls.filter(([u, o]) => String(u).includes("/employer-calls") && !(o as { method?: string } | undefined)?.method).length;
    vi.mocked(apiFetch).mockImplementation(((url: string, opts?: { method?: string }) =>
      failing && !opts?.method && url.includes("/employer-calls")
        ? Promise.resolve({ ok: false, status: 500, data: null, error: { message: "The API is down." } })
        : real(url as never, opts as never)) as never);
    try {
      const w = mount(EmployerCallsPanel, {
        props: { driverId: "d1" },
        global: {
          plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
        },
      });
      await settle(w as never);
      expect(w.text()).toContain("Could not load the employer calls.");
      const before = asked();
      failing = false;
      await w.findAll("button").find((b) => b.text().trim() === "Retry")!.trigger("click");
      await settle(w as never);
      expect(asked()).toBe(before + 1);
      expect(w.text()).not.toContain("Could not load the employer calls.");
    } finally {
      vi.mocked(apiFetch).mockImplementation(real);
    }
  });
});

describe("HW5d: applying what the employer corrected", () => {
  const CALL = "50000000-0000-4000-8000-000000000001";
  const withCorrection = (filed = false) => ({
    ...LIST(filed),
    employers: [{ ...LIST(filed).employers[0], positionHeld: "Driver", reasonForLeaving: null, operatedCmv: true, safetySensitive: null }],
    calls: [{
      id: CALL, employerKey: KEY, employerName: "Kowlage Haulage",
      outcomes: { dates: "corrected", position: "confirmed", reason: "confirmed", cmv: "corrected", dot_tested: "confirmed" },
      corrections: { dates: "02/2023–11/2024", cmv: "No, dispatch only" },
      answeredBy: "Pat", calledAt: "2026-10-30T15:00:00Z", copiedInquiryId: null,
    }],
    revision: 4,
  });

  it("shows what they said beside what the application says, and writes the confirmed dates with the revision", async () => {
    state.list = withCorrection();
    const w = mountPanel();
    await settle(w);
    const rows = w.findAll("[data-call-correction]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("they said “02/2023–11/2024”");
    expect(rows[0]!.text()).toContain("The application says 01/01/2023 – now");
    await rows[0]!.findAll("button").find((b) => b.text() === "Apply")!.trigger("click");
    await settle(w);
    await button(w, "Write it into the application")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: `/api/recruitment/applicants/d1/employer-calls/${CALL}/apply`,
      method: "POST",
      body: { question: "dates", started_on: "2023-02-01", ended_on: "2024-11-30", revision: 4 },
    }]);
  });

  it("pre-fills a yes/no from the employer's words", async () => {
    state.list = withCorrection();
    const w = mountPanel();
    await settle(w);
    await w.findAll("[data-call-correction]")[1]!.findAll("button").find((b) => b.text() === "Apply")!.trigger("click");
    await settle(w);
    await button(w, "Write it into the application")!.trigger("click");
    await settle(w);
    expect(state.requests.at(-1)!.body).toEqual({ question: "cmv", value: false, revision: 4 });
  });

  it("offers nothing to apply once the application is filed, or to a role that cannot record calls", async () => {
    state.list = withCorrection(true);
    expect((await (async () => { const w = mountPanel(); await settle(w); return w; })()).findAll("[data-call-correction]")).toHaveLength(0);
    state.list = withCorrection();
    state.canManage = false;
    const w = mountPanel();
    await settle(w);
    expect(w.findAll("[data-call-correction]")).toHaveLength(0);
  });
});
