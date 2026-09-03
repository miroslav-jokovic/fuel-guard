import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import BillingPage from "./BillingPage.vue";

/**
 * D-FIN15 at page grain: the dispatcher tab prints a rate per billed mile and a rank, a
 * dispatcher whose loads carried no distance reads a dash rather than $0.00, and a failed fetch
 * is shown in the table instead of an empty state. Composables are mocked at the module seam;
 * `useMediaQuery` is stubbed so DataTable renders a table, not cards (the web test trap).
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
const q = (data: unknown, err: string | null = null) => ({
  data: ref(data),
  isLoading: ref(false),
  isFetching: ref(false),
  isError: ref(err != null),
  error: ref(err ? new Error(err) : null),
  refetch: vi.fn(),
});
let dispatcherError: string | null = null;
vi.mock("@/features/billing/useInvoices", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useInvoicesQuery: () => q({ entries: [], total: 0 }),
    useMarginByTruckQuery: () => q([]),
  };
});
vi.mock("@/features/billing/useDispatcherEarnings", () => ({
  useDispatcherEarningsQuery: () =>
    q(
      dispatcherError
        ? []
        : [
            { dispatcherUserId: "vladi", dispatcherName: "Vladi Popov", loads: 2, linehaul: 5000, accessorial: 150, revenue: 5150, unpostedLoads: 0, miles: 1600, loadsWithoutMiles: 0, ratePerMile: 3.22 },
            { dispatcherUserId: "chris", dispatcherName: "Chris", loads: 1, linehaul: 800, accessorial: 0, revenue: 800, unpostedLoads: 1, miles: 0, loadsWithoutMiles: 1, ratePerMile: null },
          ],
      dispatcherError,
    ),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/billing", component: BillingPage }] });
  await router.push("/billing");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(BillingPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  const tab = w.findAll('[role="tab"]').find((t) => t.text().includes("Per dispatcher"));
  await tab!.trigger("click");
  await flushPromises();
  return w;
}

describe("BillingPage — per dispatcher (D-FIN15)", () => {
  it("prints rank, billed miles and rate per mile; a dispatcher without distances reads a dash", async () => {
    const w = await mountPage();
    const text = w.text();
    expect(text).toContain("Rate / mile");
    expect(text).toContain("$3.22");
    expect(text).toContain("1,600");
    // Chris: no booked load carried a distance — a dash, never $0.00.
    const rows = w.findAll("tbody tr");
    const chris = rows.find((r) => r.text().includes("Chris"))!;
    const rateCell = chris.findAll("td")[4]!; // #, Dispatcher, Loads, Billed miles, Rate / mile
    expect(rateCell.text()).toBe("—");
    expect(rateCell.text()).not.toContain("$0.00");
    // Rank follows booked revenue: Vladi is 1, Chris is 2.
    expect(rows[0]!.text().startsWith("1")).toBe(true);
    expect(rows[1]!.text().startsWith("2")).toBe(true);
  });

  it("a failed fetch is shown in the table, not swallowed into an empty state", async () => {
    dispatcherError = "dispatcher earnings unavailable";
    try {
      const w = await mountPage();
      expect(w.text()).toContain("dispatcher earnings unavailable");
      expect(w.text()).not.toContain("No dispatcher earnings for this date range");
    } finally {
      dispatcherError = null;
    }
  });
});
