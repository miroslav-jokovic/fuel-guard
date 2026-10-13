import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { answerConfirm } from "@/testing/confirm";

/**
 * Alerts' bulk Resolve and False alarm ask through the product's dialog, not the browser's (D-US7).
 * The question carries the count of alerts that will actually change, the button says what will be
 * done to how many, and a "no" changes nothing. `useConfirm` is called at the composable's setup
 * (`useAnomaliesPage`), so this also pins that the page can ask at all.
 */
const transition = vi.hoisted(() => vi.fn(async (_body: unknown) => ({})));
const anomalyRow = {
  id: "a1", org_id: "o1", vehicle_id: "v-654", transaction_id: null, rule_id: "fuel.theft",
  severity: "high", status: "open", message: "Possible theft", created_at: "2026-08-15T14:00:00Z",
  fueled_at: "2026-08-15T14:00:00Z", version: 1,
};
vi.mock("@/features/anomalies/useAnomalies", () => ({
  useAnomaliesQuery: () => ({
    data: ref([anomalyRow]),
    isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
  }),
  useAnomalyTransition: () => ({ mutateAsync: transition }),
  useAnomalyTxnDrivers: () => ({ data: ref({}) }),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: "v-654", unit_number: "654" }]) }) }));
vi.mock("@/composables/useTrailers", () => ({ useTrailersQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import AnomaliesPage from "./AnomaliesPage.vue";

async function selectAndPress(label: string, answer: boolean) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/anomalies", component: { template: "<div/>" } },
      { path: "/settings/data", component: { template: "<div/>" } },
    ],
  });
  await router.push("/anomalies");
  await router.isReady();
  const w = mount(AnomaliesPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  const asked = answerConfirm(answer, pinia);
  w.findComponent({ name: "DataTable" }).vm.$emit("update:selected", new Set(["a1"]));
  await flushPromises();
  await w.findAll("button").find((b) => b.text() === label)!.trigger("click");
  await flushPromises();
  return asked;
}

beforeEach(() => transition.mockClear());

describe("Alerts' bulk actions ask first (D-US7)", () => {
  it("names how many it will resolve, and resolves nothing on a no", async () => {
    const asked = await selectAndPress("Resolve", false);
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ title: "Resolve 1 alert?", confirmLabel: "Resolve 1 alert" }));
    expect(transition).not.toHaveBeenCalled();
  });

  it("resolves on a yes", async () => {
    await selectAndPress("Resolve", true);
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", status: "resolved" }));
  });

  it("says False alarm on the button that marks one", async () => {
    const asked = await selectAndPress("False alarm", true);
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Mark 1 alert as false alarm" }));
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed", disposition: "false_positive" }));
  });
});
