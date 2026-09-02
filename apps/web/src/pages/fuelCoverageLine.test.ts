import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";

/**
 * FUEL-T5 — the attribution line is ON the two raw-feed pages, and is given the right list's numbers.
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
vi.mock("@/features/fueling/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: { value: [] } }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));

import TransactionsPage from "./TransactionsPage.vue";
import RejectionsPage from "./RejectionsPage.vue";

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
