import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/** D-US6 — the PSP allowance in the order drawer is a FactList: used, limit, remaining. */
vi.mock("@/features/recruitment/usePspOrder", () => ({
  usePspPreflightQuery: () => ({
    isLoading: ref(false),
    data: ref({ enabled: true, refusal: null, billsOn: ["Success"], unitPriceUsd: null, environment: "production", budget: { used: 3, limit: 10, remaining: 7 } }),
  }),
  useOrderPspRecord: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
const PspOrderDrawer = (await import("./PspOrderDrawer.vue")).default;

beforeEach(() => setActivePinia(createPinia()));

describe("the PSP order drawer's budget", () => {
  it("pairs this month's used, limit and remaining with their labels", () => {
    const w = mount(PspOrderDrawer, {
      props: { open: true, driverId: "d1", driverName: "Ann Lee" },
      global: { stubs: { SlideOver: { template: "<div><slot /><slot name='footer' /></div>" }, StepUpPrompt: true } },
    });
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Used this month", "Monthly limit", "Remaining"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["3", "10", "7"]);
  });
});
