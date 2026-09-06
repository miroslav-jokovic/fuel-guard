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
const state = vi.hoisted(() => ({ error: null as string | null }));
const entry = (id: string, category: string, dispatcher: string | null) => ({
  id, direction: "earning", category, amount: 1234.56, occurred_at: "2026-07-14T14:00:00Z", settled_at: null, vehicle_id: null, driver_id: null,
  source: "mcleod", source_table: "mcleod_billing", external_id: `INV-${id}`, lifecycle_stage: "posted", is_canonical: true, is_void: false, ledger_account: null, dispatcher_name: dispatcher,
});
vi.mock("@/features/billing/useInvoices", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useInvoicesQuery: () => ({
      data: ref(state.error ? undefined : { entries: [entry("1", "linehaul_revenue", "pete"), entry("2", "accessorial_revenue", null)], total: 2 }),
      isLoading: ref(false),
      isFetching: ref(false),
      isError: ref(state.error != null),
      error: ref(state.error ? new Error(state.error) : null),
      refetch: vi.fn(),
    }),
  };
});

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/billing", component: BillingPage }] });
  await router.push("/billing");
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
      expect(w.text()).toContain("invoices unavailable");
      expect(w.text()).not.toContain("No invoices in this date range");
    } finally {
      state.error = null;
    }
  });
});
