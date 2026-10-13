import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import BillingPage from "./BillingPage.vue";

/**
 * The Invoices page (R7 — "Revenue & margin" until the dispatcher table moved onto the fleet
 * report and the per-truck margin was retired, D-FLEET1). What is pinned: it is one table with no
 * tabs, an invoice prints its charge type in plain words with the industry term in the hover, an
 * order with no operations user reads "Unassigned", and a failed fetch is shown in the table
 * (D-FIN15). `useMediaQuery` is stubbed so DataTable renders a table, not cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
const state = vi.hoisted(() => ({ error: null as string | null, filter: null as null | { value: Record<string, unknown> } }));
const entry = (id: string, category: string, dispatcher: string | null) => ({
  id, direction: "earning", category, amount: 1234.56, occurred_at: "2026-07-14T14:00:00Z", settled_at: null, vehicle_id: null, driver_id: null,
  source: "mcleod", source_table: "mcleod_billing", external_id: `INV-${id}`, lifecycle_stage: "posted", is_canonical: true, is_void: false, ledger_account: null, dispatcher_name: dispatcher,
});
vi.mock("@/features/billing/useInvoices", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useInvoicesQuery: (filter: { value: Record<string, unknown> }) => (state.filter = filter, {
      data: ref(state.error ? undefined : { entries: [entry("1", "linehaul_revenue", "pete"), entry("2", "accessorial_revenue", null)], total: 2 }),
      isLoading: ref(false),
      isFetching: ref(false),
      isError: ref(state.error != null),
      error: ref(state.error ? new Error(state.error) : null),
      refetch: vi.fn(),
    }),
  };
});

let router: ReturnType<typeof createRouter>;
async function mountPage(url = "/billing") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/billing", component: BillingPage }] });
  await router.push(url);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(BillingPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return w;
}

describe("BillingPage — invoices (R7)", () => {
  it("is one table with no tabs, naming the charge type in plain words", async () => {
    const w = await mountPage();
    expect(w.findAll('[role="tab"]').length).toBe(0);
    const t = w.text();
    expect(t).toContain("Freight");
    expect(t).toContain("Extra");
    expect(t).toContain("INV-1");
    expect(t).toContain("pete");
    expect(t).toContain("Unassigned");
    expect(t).not.toContain("Per truck");
    expect(t).not.toContain("Per dispatcher");
  });

  it("a failed fetch is shown in the table, not swallowed into an empty state", async () => {
    state.error = "invoices unavailable";
    try {
      const w = await mountPage();
      expect(w.text()).toContain("Could not load the billing records.");
      expect(w.text()).not.toContain("invoices unavailable");
      expect(w.text()).not.toContain("No invoices in this date range");
    } finally {
      state.error = null;
    }
  });

  /** The trailing ninety days is where the page opens, so clearing puts the window back there, not to nothing. */
  it("offers Clear filters once the window moves, and clearing returns it to the trailing ninety days", async () => {
    const { trailingDays } = await import("@/lib/dateWindow");
    const DateRangeFilter = (await import("@/components/DateRangeFilter.vue")).default;
    const w = await mountPage();
    const range = () => w.findComponent(DateRangeFilter);
    const clearFilters = () => w.findAll("button").find((b) => b.text() === "Clear filters");
    const opening = range().props("from");
    expect(opening).toBe(trailingDays(90).from);
    expect(clearFilters()).toBeUndefined();

    range().vm.$emit("update:from", "2026-01-01");
    await flushPromises();
    await clearFilters()!.trigger("click");
    expect(range().props("from")).toBe(opening);
    expect(clearFilters()).toBeUndefined();
  });

  /**
   * D-US2 (UI-STANDARDIZATION, 2026-10-12): the search, the window and the page are in the URL. The
   * trailing ninety days are the default and never written, so a bookmark keeps meaning "recent".
   */
  it("opens on the trailing ninety days with nothing in the URL", async () => {
    const { trailingDays } = await import("@/lib/dateWindow");
    await mountPage();
    expect(state.filter!.value).toEqual({ q: "", ...trailingDays(90), page: 1 });
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reads a pasted link's search, window and page", async () => {
    await mountPage("/billing?search=INV-9&from=2026-01-01&to=2026-01-31&page=2");
    expect(state.filter!.value).toEqual({ q: "INV-9", from: "2026-01-01", to: "2026-01-31", page: 2 });
  });

  it("reads a date that is not a real day as the default end", async () => {
    const { trailingDays } = await import("@/lib/dateWindow");
    await mountPage("/billing?from=2026-02-30");
    expect(state.filter!.value.from).toBe(trailingDays(90).from);
  });

  it("writes a window change and returns to page 1; Clear filters empties the URL", async () => {
    const DateRangeFilter = (await import("@/components/DateRangeFilter.vue")).default;
    const w = await mountPage("/billing?page=3");
    w.findComponent(DateRangeFilter).vm.$emit("update:from", "2026-01-01");
    w.findComponent(DateRangeFilter).vm.$emit("update:to", "2026-01-31");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ from: "2026-01-01", to: "2026-01-31" });

    await w.findAll("button").find((b) => b.text() === "Clear filters")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
  });
});
