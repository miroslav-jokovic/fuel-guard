import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";

/**
 * The review batch's fill cards (D-US6): each sampled fill's figures are a `FactList`, so a label sits
 * beside its value and a figure the fill does not carry is the list's em dash. The page's wording has
 * its own suite (`detectionToolsWording.test.ts`) and its two buttons theirs (`sp5PageDoors.test.ts`).
 */
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, role: "admin" }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/composables/useVehicles", async () => {
  const { ref } = await import("vue");
  return { useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "654" }]) }) };
});
vi.mock("@/features/anomalies/useRecallAudit", async () => {
  const { ref } = await import("vue");
  const fill = {
    id: "f1", vehicleId: "v1", fueledAt: "2026-10-01T12:00:00Z", gallons: 100, totalCost: 380, computedMpg: null,
    odometer: 412000, locationText: null, city: null, state: null, observedCity: "Joliet", observedState: "IL",
  };
  return {
    useAuditSample: () => ({ data: ref([fill]), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useRecallMetrics: () => ({ data: ref(null) }),
    useRecordVerdict: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  };
});

// Imported once at the top: a per-test dynamic import counts against the test's 5 s budget.
const Page = (await import("./RecallAuditPage.vue")).default;

describe("RecallAuditPage — a sampled fill's figures", () => {
  it("pairs each figure with its label, and draws a dash where the fill carries none", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div/>" } }] });
    const w = mount(Page, { global: { plugins: [router], stubs: { PageHeader: true } } });
    await flushPromises();
    const pairs = Object.fromEntries(w.get("dl").findAll("dl > div").map((d) => [d.get("dt").text(), d.get("dd").text()]));
    expect(pairs).toEqual({
      Gallons: "100",
      Cost: "$380",
      MPG: "—",
      Odometer: (412000).toLocaleString(),
      "EFS location": "—",
      "Samsara saw": "Joliet, IL",
    });
  });
});
