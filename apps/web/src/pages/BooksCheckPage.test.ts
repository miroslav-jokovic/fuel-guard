import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import BooksCheckPage from "./BooksCheckPage.vue";

/**
 * D-FIN14/15 at page grain: a hardened month reads Hardened with no reasons, an open month prints
 * every reason the API named, the counts above the table agree with the rows, and a failed fetch is
 * shown in the table. `useMediaQuery` is stubbed so the table renders as a table.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
let failWith: string | null = null;
vi.mock("@/features/accounting/useMonthCloses", () => ({
  useMonthClosesQuery: () => ({
    data: ref(
      failWith
        ? []
        : [
            { company_id: "TMS", period_start: "2026-06-01", period_end: "2026-07-01", swept_at: "2026-09-02T02:05:00Z", computed_at: "2026-09-03T00:00:00Z", gl_revenue: "5107789.04", gl_expenses: "3633776.21", anchored: true, attributed_direct: "2000000", fixed_charged: "573000", allocated_overhead: "1000000", unallocated_overhead: "0", owner_operator_pool: "60776.21", cpm_residual: "0", settlement_drift: "0", billing_drift: "0", fuel_residual: "0", status: "hardened", open_reasons: [] },
            { company_id: "TMS", period_start: "2026-08-01", period_end: "2026-09-01", swept_at: "2026-09-02T02:05:00Z", computed_at: "2026-09-03T00:00:00Z", gl_revenue: "4000000", gl_expenses: "3000000", anchored: true, attributed_direct: "1", fixed_charged: "0", allocated_overhead: "0", unallocated_overhead: "0", owner_operator_pool: "0", cpm_residual: "-12.5", settlement_drift: null, billing_drift: "0", fuel_residual: "444.19", status: "open", open_reasons: ["month is 1 month(s) old — McLeod may still be posting it (hardens at 2)", "CPM buckets miss the ledger by $12.50", "settlements (SET): no sweep behind this module yet"] },
          ],
    ),
    isLoading: ref(false),
    isFetching: ref(false),
    isError: ref(failWith != null),
    error: ref(failWith ? new Error(failWith) : null),
    refetch: vi.fn(),
  }),
}));

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/books-check", component: BooksCheckPage }] });
  await router.push("/books-check");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(BooksCheckPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return w;
}

describe("BooksCheckPage", () => {
  it("prints each month's verdict, the open month's reasons, and counts that agree with the rows", async () => {
    const w = await mountPage();
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    const june = rows.find((r) => r.text().includes("June 2026"))!;
    expect(june.text()).toContain("Hardened");
    expect(june.text()).toContain("$5,107,789.04");
    const aug = rows.find((r) => r.text().includes("August 2026"))!;
    expect(aug.text()).toContain("Open");
    expect(aug.text()).toContain("CPM buckets miss the ledger by $12.50");
    expect(aug.text()).toContain("no sweep behind this module yet");
    expect(w.text()).toContain("Hardened months");
    expect(w.text()).toContain("Open months");
  });

  it("a failed fetch is shown in the table, not an empty state", async () => {
    failWith = "closes unavailable";
    try {
      const w = await mountPage();
      expect(w.text()).toContain("closes unavailable");
      expect(w.text()).not.toContain("No month has been closed yet");
    } finally {
      failWith = null;
    }
  });
});
