import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * "Check again": shown only to the fuel section's manage set (the route is `requireSection("fuel")`), and on
 * success it opens the NEW check — the one that replaced this page's — and says what it closed.
 */
const state = vi.hoisted(() => ({ can: true, push: vi.fn(), success: vi.fn(), error: vi.fn(), result: {} as unknown, fail: null as Error | null }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.can }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: state.success, error: state.error }) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("./useReconRuns", async () => {
  const { ref } = await import("vue");
  class ReconRejected extends Error {
    constructor(message: string, readonly reasons: string[]) { super(message); }
  }
  return {
    ReconRejected,
    useRecheckStatement: () => ({
      isPending: ref(false),
      mutateAsync: async () => {
        if (state.fail) throw state.fail;
        return state.result;
      },
    }),
  };
});

import RecheckInvoiceButton from "./RecheckInvoiceButton.vue";

beforeEach(() => {
  setActivePinia(createPinia());
  state.can = true;
  state.fail = null;
  state.push.mockReset();
  state.success.mockReset();
  state.error.mockReset();
});

describe("RecheckInvoiceButton", () => {
  it("is not shown to somebody outside the fuel manage set", () => {
    state.can = false;
    expect(mount(RecheckInvoiceButton, { props: { statementId: "s1" } }).find("button").exists()).toBe(false);
  });

  it("opens the new check and says what it closed", async () => {
    state.result = { ok: true, runId: "r2", carried: { recheckDropped: 62, billedLate: 0, recordedLate: 3, error: null } };
    const w = mount(RecheckInvoiceButton, { props: { statementId: "s1" } });
    await w.find("button").trigger("click");
    await flushPromises();
    expect(state.success).toHaveBeenCalledWith("Checked again", "Closed earlier findings: 62 no longer found, 3 recorded late, now matched.");
    expect(state.push).toHaveBeenCalledWith({ name: "fuel-invoice-check", params: { id: "r2" } });
  });

  it("says why when the server refuses", async () => {
    const { ReconRejected } = await import("./useReconRuns");
    state.fail = new ReconRejected("No PDF was kept for this statement, so it cannot be checked again.", []);
    const w = mount(RecheckInvoiceButton, { props: { statementId: "s1" } });
    await w.find("button").trigger("click");
    await flushPromises();
    expect(state.error).toHaveBeenCalledWith("No PDF was kept for this statement, so it cannot be checked again.", undefined);
    expect(state.push).not.toHaveBeenCalled();
  });
});
