import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { AnnualDisagreementDto, ShopSummary } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Annual dates to check (DISPATCH-BOARD-V2-PLAN Q-DBV2) — the list behind the Shop card's figure. Which
 * units disagree is the shared rule's (`maintenanceDue.test.ts`) and the order is the server's
 * (`shopSummary.test.ts`); what only shows here is what the shop reads: both dates in the record's own
 * words, how far apart, what to fix and where, and which rows change what the board says.
 */
const annuals = ref<AnnualDisagreementDto[]>([]);
const summary = ref<ShopSummary | undefined>(undefined);
vi.mock("@/features/maintenance/useShopBacklog", async () => {
  const { ref: r } = await import("vue");
  const q = (data: unknown) => ({ data, isLoading: r(false), isError: r(false), refetch: vi.fn() });
  return { useAnnualDisagreementsQuery: () => q(annuals), useShopSummaryQuery: () => q(summary) };
});
vi.mock("@/composables/useOrgTimezone", () => ({
  useOrgTimezone: () => ({ zone: computed(() => "America/Chicago"), isResolved: computed(() => true) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
// Whether the reader may open the page is `useOpens`'s rule, tested with it; here every door opens.
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));

const AnnualDatesPage = (await import("@/pages/AnnualDatesPage.vue")).default;
const ShopWidget = (await import("@/features/maintenance/ShopWidget.vue")).default;

async function mountAt(component: unknown, url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  const w = mount(component as never, { global: { plugins: [router] } });
  await flushPromises();
  return Object.assign(w, { router });
}

const row = (o: Partial<AnnualDisagreementDto>): AnnualDisagreementDto => ({
  subjectType: "tractor", unitId: "v-654", unitNumber: "654", ourExpiresOn: "2027-03-01", fleetpalDueOn: "2027-04-01",
  ours: "valid", fleetpal: "valid", gapDays: 31, ...o,
});
const ROWS = [
  row({ unitId: "v-817", unitNumber: "817", ourExpiresOn: null, fleetpalDueOn: "2027-09-01", ours: "unknown", gapDays: null }),
  row({ subjectType: "trailer", unitId: "t-9001", unitNumber: "9001", ourExpiresOn: "2026-11-20", fleetpalDueOn: "2026-10-10", fleetpal: "expired", gapDays: -41 }),
  row({}),
  row({ unitId: "v-3152", unitNumber: "3152", ourExpiresOn: "2027-09-06", fleetpalDueOn: "2026-09-06", gapDays: -365 }),
];
const cells = (w: Awaited<ReturnType<typeof mountAt>>, unit: string) =>
  w.findAll("tbody tr").find((tr) => tr.find("td").text().startsWith(unit))!.findAll("td").map((td) => td.text());

beforeEach(() => {
  setActivePinia(createPinia());
  // The table's desktop layout (DataTable draws cards on a phone); jsdom has no `matchMedia`.
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T15:00:00.000Z"));
  annuals.value = ROWS;
});
afterEach(() => vi.useRealTimers());

describe("annual dates to check", () => {
  it("shows both dates in the record's own words, how far apart, and keeps the server's order", async () => {
    const w = await mountAt(AnnualDatesPage, "/shop/annual-dates");
    expect(w.findAll("tbody tr").map((tr) => tr.find("td").text())).toEqual(["817Truck", "9001Trailer", "654Truck", "3152Truck"]);
    expect(cells(w, "9001").slice(1, 4)).toEqual(["11/20/2026", "Overdue by 6 days10/10/2026", "41 days"]);
    expect(cells(w, "817").slice(1, 4)).toEqual(["Not recorded", "09/01/2027", "—"]);
    expect(w.text()).toContain("4 trucks and trailers");
  });

  it("says what to fix and where, from which side is later", async () => {
    const w = await mountAt(AnnualDatesPage, "/shop/annual-dates");
    expect(cells(w, "817")[4]).toContain("No annual on our record. Record the unit's last inspection.");
    expect(cells(w, "654")[4]).toContain("FleetPal has a later inspection. Check that it reached our record.");
    expect(cells(w, "3152")[4]).toContain("FleetPal's schedule is behind our record. Mark the inspection done in FleetPal.");
  });

  it("names the rows that change what the board says, and only those", async () => {
    const w = await mountAt(AnnualDatesPage, "/shop/annual-dates");
    const flagged = (unit: string) => cells(w, unit)[4]!.includes("Dispatch would use a different date");
    expect(["817", "9001", "654", "3152"].map(flagged)).toEqual([true, true, false, false]);
  });

  it("opens the unit in the annual register, on its own tab", async () => {
    const w = await mountAt(AnnualDatesPage, "/shop/annual-dates");
    const href = (unit: string) => w.findAll("tbody a").find((a) => a.text() === unit)!.attributes("href");
    expect(href("654")).toBe("/shop/inspections?search=654");
    expect(href("9001")).toBe("/shop/inspections?type=trailer&search=9001");
  });

  it("narrows by type and unit from the URL, and says when nothing disagrees", async () => {
    const trailers = await mountAt(AnnualDatesPage, "/shop/annual-dates?type=trailer");
    expect(trailers.findAll("tbody tr")).toHaveLength(1);
    const found = await mountAt(AnnualDatesPage, "/shop/annual-dates?search=31");
    expect(found.findAll("tbody tr").map((tr) => tr.find("td").text())).toEqual(["3152Truck"]);
    annuals.value = [];
    expect((await mountAt(AnnualDatesPage, "/shop/annual-dates")).text()).toContain("FleetPal and our record agree on every annual inspection date.");
  });
});

describe("the Shop card", () => {
  it("counts the annual dates to check and opens their list", async () => {
    summary.value = { openWorkOrders: 3, oldestOpenWorkOrderAt: null, unresolvedDefects: 2, lowStockLines: 1, annualDisagreements: 84 };
    const w = await mountAt(ShopWidget, "/");
    expect(w.text()).toContain("Annual dates to check");
    expect(w.text()).toContain("84");
    expect(w.findAll("a").some((a) => a.attributes("href") === "/shop/annual-dates")).toBe(true);
  });
});
