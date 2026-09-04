import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import FleetReportPage from "./FleetReportPage.vue";
import type { FleetReportResponse, FleetTruck } from "@/features/accounting/useFleetReport";

/**
 * The fleet report page, mounted — written at R1 of the UI plan, when the page was split into a
 * shell and one component per tab, so that a split which changed nothing on screen has a test
 * saying so. What is pinned is the behaviour the shell owns and the tabs inherit: the provenance
 * line comes from the fleet report call, the coverage warning shows only when there is a reason,
 * each tab is mounted fresh so paging resets on a tab change (owner ruling 2026-08-29), and a
 * failed fetch is shown in words rather than as an empty state (D-FIN15).
 *
 * Composables are mocked at the module seam; `useMediaQuery` is stubbed so DataTable renders a
 * table rather than cards (the web test trap), and `BaseChart` is stubbed because jsdom has no
 * canvas.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

const state = vi.hoisted(() => ({
  fleetError: null as string | null,
  coverageReason: null as string | null,
  truckCount: 3,
}));

const q = (data: unknown, err: string | null = null) => ({
  data: ref(err ? undefined : data),
  isLoading: ref(false),
  isFetching: ref(false),
  isError: ref(err != null),
  error: ref(err ? new Error(err) : null),
  refetch: vi.fn(),
});

const column = (o: Partial<FleetReportResponse["total"]> = {}): FleetReportResponse["total"] => ({
  trucks: 172,
  miles: 1_552_337,
  revenue: 4_828_189.24,
  expenses: 4_058_143.38,
  net: 770_045.86,
  revenuePerMile: 3.11,
  costPerMile: 2.61,
  netPerMile: 0.5,
  ...o,
});

/** `n` company trucks plus one contractor truck, so the default filter has something to hide. */
function trucks(n: number): FleetTruck[] {
  const rows: FleetTruck[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ tractor_unit: String(700 + i), loads: 10, miles: 8_000, revenue: 24_000, revenuePerMile: 3, isOwnerOperator: false });
  }
  rows.push({ tractor_unit: "901", loads: 4, miles: 6_000, revenue: 20_000, revenuePerMile: 3.33, isOwnerOperator: true });
  return rows;
}

const report = (): FleetReportResponse => ({
  period: { from: "2026-07-01", to: "2026-07-31" },
  total: column(),
  company: column({ trucks: 163 }),
  ownerOperator: column({ trucks: 9, miles: 71_920, revenue: 237_576.29, expenses: 212_492.09, net: 25_084.2 }),
  ownerOperatorBasis: { trucks: ["901"], settlements: 12, pay: 200_000, loadRevenue: 203_192.01, deductionIncome: 34_384.28, unruledDeductions: 0 },
  billedMiles: 1_389_814,
  emptyMiles: 162_523,
  emptyPct: 10.5,
  revenuePerBilledMile: 3.47,
  mileageReason: null,
  statement: { sections: [], revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, toDateRevenue: null, toDateExpenses: null, toDateNet: null, unrecognisedNet: 0 },
  tieOut: { revenue: 0, expenses: 0 },
  monthsCovered: ["2026-07"],
  monthsMissing: [],
  monthsPartial: [],
  ledgerReason: null,
  families: {
    revenue: [],
    expense: [{ key: "fuel", label: "Fuel and fluids", isRevenue: false, isUnassigned: false, amount: 1_010_000, toDateAmount: null, pctOfRevenue: 20.9, toDatePctOfRevenue: null, perMile: 0.65, accounts: 3 }],
    tieOut: { revenue: 0, expenses: 0 },
  },
  sweptAt: "2026-08-28T21:02:56.551Z",
  trucks: trucks(state.truckCount),
  ownerOperators: [
    { payeeId: "JRM Transport", units: ["901"], settlements: 12, revenue: 237_576.29, pay: 200_000, grossMargin: 37_576.29, deductionIncome: 34_384.28, netMargin: 71_960.57, dealPct: 84.2 },
  ],
  toDateFrom: "2026-01-01",
});

vi.mock("@/features/accounting/useFleetReport", () => ({
  useFleetReportQuery: () => q(report(), state.fleetError),
}));
vi.mock("@/features/accounting/useIncomeStatement", () => ({
  useIncomeStatementQuery: () =>
    q({
      sections: [
        {
          typeId: "OE",
          label: "Operating Expenses",
          isRevenue: false,
          isUnrecognised: false,
          total: 972_820.53,
          toDateTotal: null,
          lines: [{ glid: "40050000", descr: "Fuel for Hired Vehicles", amount: 972_820.53, pctOfRevenue: 20.1, toDateAmount: null, toDatePctOfRevenue: null, modules: [{ post_module: "FUEL", amount: 972_820.53, lines: 5_777 }] }],
        },
      ],
      revenue: 4_828_189.24,
      expenses: 4_058_143.38,
      net: 770_045.86,
      toDateRevenue: null,
      toDateExpenses: null,
      toDateNet: null,
      unrecognisedNet: 0,
      monthsCovered: ["2026-07"],
      monthsMissing: ["2026-08"],
      monthsPartial: [],
      ledgerReason: null,
      toDateFrom: "2026-01-01",
    }),
}));
vi.mock("@/features/accounting/useMileageCoverage", () => ({
  useMileageCoverageQuery: () => q({ months: [], miles: 1_552_337, trucks: 172, reason: state.coverageReason, billedMiles: 1_389_814, loads: 1_415, billedRevenue: 4_994_450.85 }),
}));
// The trend decides which month the page opens on (D-FRUI1): August was swept before it ended, so
// the latest reportable month is July whatever the calendar says.
vi.mock("@/features/accounting/useFleetTrend", () => ({
  useFleetTrendQuery: () =>
    q({
      points: [
        { month: "2026-06", revenue: 5_107_789.04, expenses: 3_634_060.11, net: 1_473_728.93, miles: 1_574_109, trucks: 170, revenuePerMile: 3.24, costPerMile: 2.31, netPerMile: 0.94, reason: null },
        { month: "2026-07", revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, miles: 1_552_337, trucks: 172, revenuePerMile: 3.11, costPerMile: 2.61, netPerMile: 0.5, reason: null },
      ],
      missing: ["2026-08"],
      rated: 2,
      monthsRequested: ["2026-06", "2026-07", "2026-08"],
      monthsPartial: [{ month: "2026-08", periodEnd: "2026-08-31", sweptAt: "2026-08-28T21:02:56Z", complete: false, shortfall: "partial" }],
    }),
}));

type W = VueWrapper<InstanceType<typeof FleetReportPage>>;

async function mountPage(): Promise<W> {
  const w = mount(FleetReportPage, {
    global: {
      plugins: [createPinia()],
      stubs: { PageHeader: { template: "<div />" }, BaseChart: { template: "<div />" }, RouterLink: { template: "<a><slot /></a>" } },
    },
    attachTo: document.body,
  }) as W;
  await flushPromises();
  return w;
}

async function openTab(w: W, label: string) {
  const tab = w.findAll('[role="tab"]').find((t) => t.text().includes(label));
  await tab!.trigger("click");
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  state.fleetError = null;
  state.coverageReason = null;
  state.truckCount = 3;
});

describe("FleetReportPage — the shell (R1)", () => {
  it("opens on the overview and qualifies it with the provenance line from the same call", async () => {
    const w = await mountPage();
    const t = w.text();
    expect(t).toContain("July 2026");
    expect(t).toContain("McLeod ledger swept");
    expect(t).toContain("2026");
    expect(t).toContain("residual $0.00");
    expect(t).toContain("$4,828,189");
    w.unmount();
  });

  it("shows the mileage-coverage warning only when the period has a reason", async () => {
    let w = await mountPage();
    expect(w.text()).not.toContain("are missing from the miles");
    w.unmount();
    state.coverageReason = "February 2026: 16 trucks that delivered loads are missing from the miles, so no rate is shown.";
    w = await mountPage();
    expect(w.text()).toContain("are missing from the miles");
    w.unmount();
  });

  it("hides contractor trucks from the per-truck tab by default, and says how many are hidden", async () => {
    const w = await mountPage();
    await openTab(w, "Per truck");
    const t = w.text();
    expect(t).toContain("1 truck is hidden by the filters above");
    expect(t).toContain("3 trucks");
    expect(t).not.toContain("901");
    w.unmount();
  });

  it("resets paging when the reader changes tab and comes back", async () => {
    state.truckCount = 25;
    const w = await mountPage();
    await openTab(w, "Per truck");
    const next = w.findAll("button").find((b) => b.text().trim().startsWith("Next"));
    await next!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Showing 21");
    await openTab(w, "Contractors");
    expect(w.text()).toContain("Contractors hauled");
    expect(w.text()).toContain("JRM Transport");
    await openTab(w, "Per truck");
    expect(w.text()).toContain("Showing 1–20");
    expect(w.text()).not.toContain("Showing 21");
    w.unmount();
  });

  it("renders the family summary above McLeod's own sections on the income statement tab", async () => {
    const w = await mountPage();
    await openTab(w, "Income statement");
    const t = w.text();
    expect(t).toContain("Fuel and fluids");
    expect(t).toContain("Operating Expenses");
    expect(t).toContain("40050000");
    expect(t).toContain("has not reached 2026-08");
    w.unmount();
  });

  it("opens on the latest month the sweep finished, and says why it is not the calendar's month", async () => {
    const w = await mountPage();
    const rail = w.find('[aria-live="polite"]');
    expect(rail.text()).toBe("July 2026");
    // The calendar's last full month is whatever today makes it; the note names it and says the
    // report opens on July instead, because the trend said August was swept on the 28th.
    if (new Date().getMonth() === 8 && new Date().getFullYear() === 2026) {
      expect(w.text()).toContain("August 2026 was swept on 2026-08-28, before the month ended, so the report opens on July 2026");
    } else {
      expect(w.text()).toContain("so the report opens on July 2026");
    }
    w.unmount();
  });

  it("keeps one period for every tab: stepping back on the rail changes the month everywhere", async () => {
    const w = await mountPage();
    const prev = w.findAll("button").find((b) => b.attributes("aria-label") === "Previous month")!;
    await prev.trigger("click");
    await flushPromises();
    expect(w.find('[aria-live="polite"]').text()).toBe("June 2026");
    await openTab(w, "Per truck");
    expect(w.find('[aria-live="polite"]').text()).toBe("June 2026");
    // The per-tab date picker is gone: the toolbar carries the truck filters and nothing else.
    expect(w.text()).not.toContain("Dates");
    w.unmount();
  });

  it("says in words when the fleet report could not be loaded, on the overview and in the truck table", async () => {
    state.fleetError = "fleet report unavailable";
    const w = await mountPage();
    expect(w.text()).toContain("The overview could not be loaded");
    expect(w.text()).not.toContain("$4,828,189");
    await openTab(w, "Per truck");
    expect(w.text()).toContain("Failed to load");
    w.unmount();
  });
});
