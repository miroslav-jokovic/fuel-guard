import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import type { DqAttentionItem, DriverOverviewRow } from "@silvicom/shared";
import QualificationFleetTable from "@/features/compliance/QualificationFleetTable.vue";

/**
 * The fleet table's filter semantics — pinned BEFORE R4b moves them into `@silvicom/shared`.
 *
 * This component had no test at all, and it owns the vocabulary the whole product means by "needs
 * attention", "has expired items" and "due in 30 days". R4b gives the roster the same filters, and
 * the only honest way to do that is one shared predicate rather than a second copy — so these
 * assertions exist to prove the move changes nothing here. They were written and recorded against
 * the inline version.
 *
 * The rows below are chosen so every branch of the switch separates them: no two drivers match the
 * same set of filters.
 *
 * ⚠ The viewport has to be declared WIDE. jsdom answers `matchMedia` false, so `DataTable` renders
 * its narrow card branch and there is no `<tbody>` to read at all — the same trap `DataTable.test.ts`
 * records. Without this the whole suite fails for a reason that has nothing to do with filtering.
 */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});
const overview = ref<{ drivers: DriverOverviewRow[]; includesHazmat: boolean; truncated: boolean }>({
  drivers: [],
  includesHazmat: true,
  truncated: false,
});

vi.mock("@/composables/useCompliance", () => ({
  useComplianceOverviewQuery: () => ({ data: overview, isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ restrictedAccess: false, can: () => true, canView: () => true }) }));

const attention = (over: Partial<DqAttentionItem> = {}): DqAttentionItem => ({
  key: "cdl", label: "CDL", citation: "§391.11", group: "licence",
  state: "expiring", goodUntil: "2026-09-30", evidenceDate: null, daysRemaining: 10, ...over,
});

const row = (over: Partial<DriverOverviewRow>): DriverOverviewRow => ({
  driver_id: "d", driver_name: "Name", driver_status: "active",
  state: "incomplete",
  counts: { current: 5, expiring: 0, expired: 0, missing: 0 },
  groups: [], attention: [], requirements: [], ...over,
});

/** One driver per branch — no two match the same filter set. */
const DRIVERS: DriverOverviewRow[] = [
  row({ driver_id: "expired", driver_name: "Ellen Expired", counts: { current: 1, expiring: 0, expired: 2, missing: 0 },
        attention: [attention({ state: "expired", daysRemaining: -5 })] }),
  row({ driver_id: "soon", driver_name: "Sam Soon", counts: { current: 1, expiring: 1, expired: 0, missing: 0 },
        attention: [attention({ daysRemaining: 10 })] }),
  row({ driver_id: "later", driver_name: "Lena Later", counts: { current: 1, expiring: 1, expired: 0, missing: 0 },
        attention: [attention({ daysRemaining: 25 })] }),
  row({ driver_id: "fresh", driver_name: "Nina New", state: "not_started",
        counts: { current: 0, expiring: 0, expired: 0, missing: 3 }, attention: [attention({ state: "missing", daysRemaining: null })] }),
  row({ driver_id: "done", driver_name: "Cora Complete", state: "complete" }),
];

const mountTable = () => {
  overview.value = { drivers: DRIVERS, includesHazmat: true, truncated: false };
  return mount(QualificationFleetTable, {
    props: { stateFilter: "", dueFilter: "" },
    global: { stubs: { RouterLink: { props: ["to"], template: "<a><slot /></a>" } } },
  });
};

const namesFor = async (stateFilter: string, dueFilter: string): Promise<string[]> => {
  const w = mountTable();
  await w.setProps({ stateFilter, dueFilter });
  // The name is the row's link, not a fixed column index: this table carries a selection checkbox
  // and an expand toggle ahead of it, and counting columns made every assertion here fail at once.
  return w.findAll("tbody tr").map((r) => r.findAll("a")[0]?.text().trim() ?? "").filter(Boolean);
};

describe("QualificationFleetTable — the filter vocabulary R4b promotes", () => {
  it("shows every driver when nothing is filtered", async () => {
    expect(await namesFor("", "")).toHaveLength(DRIVERS.length);
  });

  it("'needs attention' is any driver with a non-current item, not a file state", async () => {
    const names = await namesFor("attention", "");
    expect(names).not.toContain("Cora Complete");
    expect(names).toHaveLength(4);
  });

  it("'has expired items' counts the item, not the file's overall word", async () => {
    expect(await namesFor("expired", "")).toEqual(["Ellen Expired"]);
  });

  it("'has items due soon' is the expiring count, and excludes the already-expired", async () => {
    const names = await namesFor("expiring", "");
    expect(names.sort()).toEqual(["Lena Later", "Sam Soon"]);
  });

  it("'file not started' and 'file complete' read the file's own state", async () => {
    expect(await namesFor("not_started", "")).toEqual(["Nina New"]);
    expect(await namesFor("complete", "")).toEqual(["Cora Complete"]);
  });

  it("'overdue' means a NEGATIVE soonest, never merely undated", async () => {
    // Nina has a missing item with no date at all; she is not overdue, she is unstarted.
    expect(await namesFor("", "overdue")).toEqual(["Ellen Expired"]);
  });

  it("a due horizon includes everything at or inside it, and nothing beyond", async () => {
    // ⚠ Recorded as it BEHAVES, which is not what I expected when writing this: an already-overdue
    // driver is inside every horizon, because the filter excludes only `soonest > N`. Defensible on
    // its own terms — an item that lapsed last week is certainly "due within 14 days" — but see the
    // test below, because the tile that SETS this filter counts it differently.
    expect((await namesFor("", "14")).sort()).toEqual(["Ellen Expired", "Sam Soon"]);
    expect((await namesFor("", "30")).sort()).toEqual(["Ellen Expired", "Lena Later", "Sam Soon"]);
  });

  /**
   * A disagreement found while pinning this, NOT introduced by R4b.
   *
   * `buildAttentionStrip`'s `dueWithin` counts `s >= 0 && s <= days` — future-dated only. This
   * table's filter excludes only `soonest > days`, so it also admits the overdue. The tile therefore
   * reports a smaller number than the list it opens: click "Due in 30 days" reading 2 and get 3 rows.
   *
   * Recorded rather than fixed here. Which side is right is a product ruling (is an expired item
   * "due"?), and changing either one silently inside a refactor would be the wrong way to answer it.
   * Written into the plan's §6 as an open question.
   */
  it("disagrees with the attention tile that sets it, for the overdue driver (recorded, not endorsed)", async () => {
    const { buildAttentionStrip } = await import("@/features/compliance/attentionStrip");
    const tile = buildAttentionStrip(DRIVERS).find((t) => t.key === "due30")!;
    const rows = await namesFor(tile.state, tile.due);

    expect(tile.n).toBe(2); // Sam and Lena — the tile does not count Ellen, who is already overdue
    expect(rows).toHaveLength(3); // …but the filter it applies does
  });

  it("combines the two filters rather than letting one win", async () => {
    // Expired items AND due within 30: Ellen qualifies on both (soonest -5 is inside 30).
    expect(await namesFor("expired", "30")).toEqual(["Ellen Expired"]);
    expect(await namesFor("complete", "30")).toEqual([]);
  });
});
