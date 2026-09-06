import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { ref, type Component } from "vue";

/**
 * FUEL-T5 — the attribution line is on all three Fuel Log tabs, and is given the right list's numbers.
 *
 * `RowCoverageLine` and `useEfsRowCoverage` are each pinned by their own suite, and both would keep
 * passing if somebody deleted the tag from a tab. So this is deliberately the smallest mount that can
 * fail for the right reason: shallow, so every child is a stub, asserting that the stub exists and
 * that the tab asked the coverage query about ITS OWN feed. A posted/rejected swap is the mistake
 * this catches — the two raw-feed tabs differ by one word and were written by copying each other.
 *
 * Moved here from `pages/` by FUEL-C2, with the three pages it mounted: Transactions and Rejections
 * are now `SourceRecordsTab` and `DeclinesTab`, and the Fuel Log's own body is `FillsTab`. The
 * assertions are unchanged, which is the point — the lines moved to the tab that owns them and kept
 * their meaning, exactly as the T5 handoff said they would when it gave `FeedFreshnessLine` a `feed`
 * prop and `RowCoverageLine` a plain object.
 */

const coverageCalls: string[] = [];
vi.mock("./useEfsData", () => ({
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
 * The Fills tab's coverage is not a query of its own — it is derived from the `fuel_range_totals` row
 * that already feeds the tiles, so the numerator and the denominator are one measurement taken at one
 * instant. `fillsWithVehicle` is therefore what this fixture varies, and `null` is the deploy-window
 * state the tab must render as silence.
 */
const rangeTotals = ref<Record<string, unknown> | null>({
  fillUps: 1000, fillsWithVehicle: 900, totalMiles: 5, totalGallons: 5, totalCost: 5,
  hasCost: true, flagged: 0, clear: 1000, fleetMpg: 7,
});
vi.mock("./useFuelLog", () => ({
  FUEL_PAGE_SIZE: 20,
  useFuelTransactions: () => ({ data: { value: { rows: [], total: 0 } }, isLoading: { value: false }, isError: { value: false }, error: { value: null }, refetch: () => {}, isFetching: { value: false } }),
  useFuelRangeTotals: () => ({ data: rangeTotals }),
  useCreateFillUp: () => ({ mutateAsync: async () => {}, isPending: { value: false } }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/composables/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: { value: [] } }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));

import SourceRecordsTab from "./SourceRecordsTab.vue";
import DeclinesTab from "./DeclinesTab.vue";
import FillsTab from "./FillsTab.vue";
import type { FuelLogSharedFilters } from "./useFuelLogFilters";

/**
 * The shared window/truck the shell owns, stubbed. The tabs only ever read `.value` off these and
 * call `clear()`, so plain refs are the whole contract; the cast keeps the stub from restating
 * `useFuelLogFilters`' internals, which are pinned by their own suite.
 */
const sharedStub = (): FuelLogSharedFilters =>
  ({
    tab: ref("fills"),
    from: ref(undefined),
    to: ref(undefined),
    units: ref([]),
    setFrom: () => {},
    setTo: () => {},
    setUnits: () => {},
    // Each `facet()` call gets its own ref, exactly as the real one gets its own URL parameter.
    facet: () => ref(""),
    clear: () => {},
  }) as unknown as FuelLogSharedFilters;

const shallow = (tab: Component) =>
  mount(tab, {
    shallow: true,
    props: { shared: sharedStub() },
    global: { plugins: [VueQueryPlugin, createPinia()] },
  });

describe("the raw-feed tabs carry the attribution line", () => {
  it("puts the line on Source records and asks about the posted feed's rows", () => {
    coverageCalls.length = 0;
    const w = shallow(SourceRecordsTab);
    expect(w.findComponent({ name: "RowCoverageLine" }).exists()).toBe(true);
    expect(coverageCalls).toEqual(["transactions"]);
  });

  it("puts the line on Declines and asks about the declines, not the purchases", () => {
    coverageCalls.length = 0;
    const w = shallow(DeclinesTab);
    expect(w.findComponent({ name: "RowCoverageLine" }).exists()).toBe(true);
    expect(coverageCalls).toEqual(["rejections"]);
  });

  it("puts both lines on Fills, whose tiles are the figures they qualify", () => {
    const w = shallow(FillsTab);
    expect(w.findComponent({ name: "RowCoverageLine" }).exists()).toBe(true);
    // The POSTED feed, because every canonical fill is `source = 'fuel_card'` (14,868 of 14,868,
    // measured 2026-09-02) — this tab's rows are that feed's rows, one derivation later.
    expect(w.findComponent({ name: "FeedFreshnessLine" }).props("feed")).toBe("posted");
  });

  it("gives Declines the rejected feed's freshness, not the posted one's", () => {
    expect(shallow(DeclinesTab).findComponent({ name: "FeedFreshnessLine" }).props("feed")).toBe("rejected");
  });

  // ⚠ The deploy-window state. `lint:migration-ordering` reads columns and cannot see a function's
  // return shape, so a reader can reach production nine minutes before 0297 does. Rendering the line
  // from a missing count would say "0% of the 14,868 fill-ups in this list name a truck" — the exact
  // confident lie T5 exists to remove, printed at maximum confidence.
  it("says nothing on Fills while the function has no attributed count to give", () => {
    rangeTotals.value = { ...(rangeTotals.value as object), fillsWithVehicle: null };
    expect(shallow(FillsTab).findComponent({ name: "RowCoverageLine" }).props("coverage")).toBeNull();

    rangeTotals.value = { ...(rangeTotals.value as object), fillsWithVehicle: 900 };
    expect(shallow(FillsTab).findComponent({ name: "RowCoverageLine" }).props("coverage")).not.toBeNull();
  });

  // The Fills tab's clause names a disagreement already on the screen: Gallons and Spend count every
  // matching fill, Total miles counts only the attributed ones. A generic clause would be consistent
  // and would describe nothing.
  it("gives Fills its own consequence clause, not the raw-feed tabs'", () => {
    const c = shallow(FillsTab).findComponent({ name: "RowCoverageLine" }).props("coverage") as { lead: string };
    expect(c.lead).toContain("in none of the miles");
    expect(c.lead).toContain("fill-ups");
  });

  // Above the filter bar, per IFTA's argument that a caveat under a list is read after the list has
  // already been believed. Both freshness lines on these tabs sit there for the same reason.
  it("renders the line above the filters, where it is met before a conclusion is drawn", () => {
    const html = shallow(SourceRecordsTab).html();
    const at = (tag: string) => {
      const i = html.indexOf(tag);
      expect(i, `${tag} is not on the tab`).toBeGreaterThan(-1);
      return i;
    };
    // Arrival, then composition, then the controls: whether the list is short, how much of what is
    // here reaches a truck, and only then the filters that scope it.
    expect(at("feed-freshness-line-stub")).toBeLessThan(at("row-coverage-line-stub"));
    expect(at("row-coverage-line-stub")).toBeLessThan(at("data-workspace-stub"));
  });
});
