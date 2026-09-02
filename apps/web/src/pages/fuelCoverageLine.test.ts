import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * FUEL-T5 — the attribution line is ON all three list pages, and is given the right list's numbers.
 *
 * `RowCoverageLine` and `useEfsRowCoverage` are each pinned by their own suite, and both would keep
 * passing if somebody deleted the tag from a page. Neither page has ever been mounted under test
 * (C2 will be the first to mount them properly), so this is deliberately the smallest mount that can
 * fail for the right reason: shallow, so every child is a stub, asserting that the stub exists and
 * that the page asked the coverage query about ITS OWN feed. A posted/rejected swap is the mistake
 * this catches — the two pages differ by one word and were written by copying each other.
 */

const coverageCalls: string[] = [];
vi.mock("@/features/reports/useEfsData", () => ({
  EFS_PAGE_SIZE: 20,
  useEfsTransactions: () => ({ data: { value: { rows: [], total: 0 } }, isLoading: { value: false }, isError: { value: false }, error: { value: null }, refetch: () => {}, isFetching: { value: false } }),
  useDeclinedTransactions: () => ({ data: { value: { rows: [], total: 0 } }, isLoading: { value: false }, isError: { value: false }, error: { value: null }, refetch: () => {}, isFetching: { value: false } }),
  useEfsFacets: () => ({ data: { value: undefined } }),
  useEfsRowCoverage: (surface: string) => {
    coverageCalls.push(surface);
    return { data: { value: { rows: 10, attributed: 9, unattributed: 1, attributedPercent: 90, complete: false, lead: `LEAD:${surface}` } } };
  },
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: { value: [] } }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: { value: [] } }) }));

/**
 * The Fuel Log's coverage is not a query of its own — it is derived from the `fuel_range_totals` row
 * that already feeds the tiles, so the numerator and the denominator are one measurement taken at one
 * instant. `fillsWithVehicle` is therefore what this fixture varies, and `null` is the deploy-window
 * state the page must render as silence.
 */
const rangeTotals = ref<Record<string, unknown> | null>({
  fillUps: 1000, fillsWithVehicle: 900, totalMiles: 5, totalGallons: 5, totalCost: 5,
  hasCost: true, flagged: 0, clear: 1000, fleetMpg: 7,
});
vi.mock("@/features/fuel/useFuelLog", () => ({
  FUEL_PAGE_SIZE: 20,
  useFuelTransactions: () => ({ data: { value: { rows: [], total: 0 } }, isLoading: { value: false }, isError: { value: false }, error: { value: null }, refetch: () => {}, isFetching: { value: false } }),
  useFuelRangeTotals: () => ({ data: rangeTotals }),
  useCreateFillUp: () => ({ mutateAsync: async () => {}, isPending: { value: false } }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/features/fueling/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: { value: [] } }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));

import TransactionsPage from "./TransactionsPage.vue";
import RejectionsPage from "./RejectionsPage.vue";
import FuelLogPage from "./FuelLogPage.vue";

const shallow = (page: unknown) =>
  mount(page as never, { shallow: true, global: { plugins: [VueQueryPlugin, createPinia()] } });

describe("the raw-feed pages carry the attribution line", () => {
  it("puts the line on Transactions and asks about the posted feed's rows", () => {
    coverageCalls.length = 0;
    const w = shallow(TransactionsPage);
    expect(w.findComponent({ name: "RowCoverageLine" }).exists()).toBe(true);
    expect(coverageCalls).toEqual(["transactions"]);
  });

  it("puts the line on Rejections and asks about the declines, not the purchases", () => {
    coverageCalls.length = 0;
    const w = shallow(RejectionsPage);
    expect(w.findComponent({ name: "RowCoverageLine" }).exists()).toBe(true);
    expect(coverageCalls).toEqual(["rejections"]);
  });

  it("puts both lines on the Fuel Log, whose tiles are the figures they qualify", () => {
    const w = shallow(FuelLogPage);
    expect(w.findComponent({ name: "RowCoverageLine" }).exists()).toBe(true);
    // The POSTED feed, because every canonical fill is `source = 'fuel_card'` (14,868 of 14,868,
    // measured 2026-09-02) — this page's rows are that feed's rows, one derivation later.
    expect(w.findComponent({ name: "FeedFreshnessLine" }).props("feed")).toBe("posted");
  });

  // ⚠ The deploy-window state. `lint:migration-ordering` reads columns and cannot see a function's
  // return shape, so a reader can reach production nine minutes before 0297 does. Rendering the line
  // from a missing count would say "0% of the 14,868 fill-ups in this list name a truck" — the exact
  // confident lie T5 exists to remove, printed at maximum confidence.
  it("says nothing on the Fuel Log while the function has no attributed count to give", () => {
    rangeTotals.value = { ...(rangeTotals.value as object), fillsWithVehicle: null };
    expect(shallow(FuelLogPage).findComponent({ name: "RowCoverageLine" }).props("coverage")).toBeNull();

    rangeTotals.value = { ...(rangeTotals.value as object), fillsWithVehicle: 900 };
    expect(shallow(FuelLogPage).findComponent({ name: "RowCoverageLine" }).props("coverage")).not.toBeNull();
  });

  // The Fuel Log's clause names a disagreement already on the page: Gallons and Spend count every
  // matching fill, Total miles counts only the attributed ones. A generic clause would be consistent
  // and would describe nothing.
  it("gives the Fuel Log its own consequence clause, not the raw-feed pages'", () => {
    const c = shallow(FuelLogPage).findComponent({ name: "RowCoverageLine" }).props("coverage") as { lead: string };
    expect(c.lead).toContain("in none of the miles");
    expect(c.lead).toContain("fill-ups");
  });

  // Above the filter bar, per IFTA's argument that a caveat under a list is read after the list has
  // already been believed. Both freshness lines on these pages sit there for the same reason.
  it("renders the line above the filters, where it is met before a conclusion is drawn", () => {
    const html = shallow(TransactionsPage).html();
    const at = (tag: string) => {
      const i = html.indexOf(tag);
      expect(i, `${tag} is not on the page`).toBeGreaterThan(-1);
      return i;
    };
    // Arrival, then composition, then the controls: whether the list is short, how much of what is
    // here reaches a truck, and only then the filters that scope it.
    expect(at("feed-freshness-line-stub")).toBeLessThan(at("row-coverage-line-stub"));
    expect(at("row-coverage-line-stub")).toBeLessThan(at("data-workspace-stub"));
  });
});
