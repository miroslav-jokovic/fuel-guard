import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { computed, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { computeIftaPosition, tieOutMiles, type IftaFuelPurchase, type IftaJurisdictionMiles } from "@silvicom/shared";
import { metersFromMiles } from "@silvicom/shared";
import type { IftaPeriodData } from "@/features/ifta/useIftaPeriod";

// SP5: the links here ask the router guard's own function (`useOpens`), which reads the session. The
// real shape, from `testing/fakeSession`; the admin opens everything unless a test says otherwise.
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});


/**
 * The ledger, mounted.
 *
 * ── THE ONE PROPERTY THAT MATTERS MOST ──────────────────────────────────────────────────────────
 * Every liability on this page derives from one fleet MPG. A period whose MPG is impossible produces
 * a full table of confident dollar figures that look exactly like correct ones — which is what 2026
 * Q2 did at 10.5 mpg, with a 31-day hole in the fuel feed behind it. So the health line must render
 * ABOVE the money and must say what is wrong, and that is asserted here rather than left to a reader
 * to notice. The arithmetic itself is `packages/shared`'s and is not re-tested.
 */
const period = ref<IftaPeriodData | null>(null);
const loading = ref(false);
const errored = ref(false);

vi.mock("@/features/ifta/useIftaPeriod", async (orig) => {
  const actual = await orig<typeof import("@/features/ifta/useIftaPeriod")>();
  return {
    ...actual,
    useIftaPeriodQuery: () => ({
      data: computed(() => period.value),
      isLoading: loading,
      isError: errored,
      error: ref(null),
    }),
  };
});

const download = vi.fn(async (_path: string, _filename: string) => {});
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiDownload: (path: string, filename: string) => download(path, filename),
}));

import IftaLedgerPage from "./IftaLedgerPage.vue";

const miles = (jurisdiction: string, taxableMiles: number): IftaJurisdictionMiles => ({
  jurisdiction, taxableMeters: metersFromMiles(taxableMiles), totalMeters: metersFromMiles(taxableMiles), taxPaidLiters: 0,
});
const bought = (jurisdiction: string, gallons: number): IftaFuelPurchase => ({
  jurisdiction, gallons, tranDate: "2026-05-15",
});

/** A quarter that hangs together: 70,000 miles on 10,000 gallons is 7.0 mpg. */
function healthy(over: Partial<IftaPeriodData> = {}): IftaPeriodData {
  const position = computeIftaPosition([miles("TX", 35_000), miles("CA", 35_000)], [bought("TX", 10_000)], "2026-05-15");
  return {
    position,
    tieOut: tieOutMiles({ samsaraMiles: 70_000, odometerMiles: 68_000, purchasedGallons: 10_000 }),
    summary: {
      odometerMiles: 68_000, odometerRejected: 0, purchasedGallons: 10_000, vehicles: 12,
      monthsFetched: 3, anyProvisional: false, maxUnmapped: 0,
      lastFetchedAt: "2026-07-02T00:00:00Z", troubleshooting: null,
    },
    samsaraTaxPaidLiters: 0,
    neverFetched: false,
    receipts: { jurisdictions: [], sources: [], duplicatesDropped: 0, duplicateGallons: 0, unmatched: 0, unmatchedUnits: [] },
    ...over,
  };
}

/** 2026 Q2's real shape: the miles are right and a month of fuel is missing. */
function fuelHole(): IftaPeriodData {
  const position = computeIftaPosition([miles("TX", 35_000), miles("CA", 35_000)], [bought("TX", 6_667)], "2026-05-15");
  return {
    ...healthy(),
    position,
    tieOut: tieOutMiles({ samsaraMiles: 70_000, odometerMiles: 42_000, purchasedGallons: 6_667 }),
  };
}

beforeEach(() => {
  setActivePinia(createPinia()); // the export buttons' failure toast
  period.value = healthy();
  loading.value = false;
  errored.value = false;
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

async function mountPage(query = "") {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ifta", name: "ifta", component: { template: "<div/>" }, meta: { title: "IFTA" } },
      { path: "/ifta/:jurisdiction", name: "ifta-jurisdiction", component: { template: "<div/>" } },
    ],
  });
  await router.push(`/ifta${query}`);
  await router.isReady();
  const w = mount(IftaLedgerPage, { global: { plugins: [router] } });
  await flushPromises();
  return { w, router };
}

describe("IftaLedgerPage", () => {
  it("shows what is owed, what was paid and the net, per jurisdiction", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toContain("California");
    expect(t).toContain("Texas");
    expect(t).toContain("Owed");
    expect(t).toContain("Paid at the pump");
    expect(t).not.toContain("NaN");
  });

  it("states the fleet MPG it used, because every liability above scales with it", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toContain("Fleet MPG used");
    expect(t).toContain("7.00");
  });

  // ── McLeod's hand-keyed receipts (IP6) ─────────────────────────────────────────────────────────
  it("says gallons bought are card fills only while the quarter has no driver-paid receipts", async () => {
    const { w } = await mountPage();
    expect(w.find('[data-testid="receipt-line"]').text()).toContain("No driver-paid receipts for this quarter yet");
    expect(w.text()).not.toContain("from driver-paid receipts");
  });

  it("shows how much of a state's gallons bought came from receipts, and accounts for the ones left out", async () => {
    const position = computeIftaPosition(
      [miles("TX", 35_000), miles("CA", 35_000)],
      [bought("TX", 9_600), { ...bought("TX", 400), source: "mcleod_receipt" }],
      "2026-05-15",
    );
    period.value = healthy({
      position,
      receipts: {
        jurisdictions: [{ jurisdiction: "TX", gallons: 400, receipts: 3 }],
        sources: [{ source: "fuel_app", receipts: 1, gallons: 150 }, { source: "mcleod", receipts: 2, gallons: 250 }],
        duplicatesDropped: 2, duplicateGallons: 160, unmatched: 1, unmatchedUnits: ["999"],
      },
    });
    const { w } = await mountPage();
    const tx = w.findAll("tbody tr").find((tr) => tr.text().includes("Texas"))!;
    expect(tx.text()).toContain("10,000");
    expect(tx.text()).toContain("incl. 400 gal from driver-paid receipts");
    const line = w.find('[data-testid="receipt-line"]').text();
    expect(line).toContain("include 400 gal from 3 driver-paid receipts (1 uploaded from the fuel app, 2 keyed in McLeod)");
    expect(line).toContain("2 more matched a card fill");
    expect(line).toContain("McLeod unit 999");
  });

  it("says nothing alarming about a quarter that hangs together", async () => {
    const t = (await mountPage()).w.text();
    expect(t).not.toContain("no tractor achieves");
    expect(t).not.toContain("FUEL is missing");
  });

  // ── the property that matters most ────────────────────────────────────────────────────────────
  it("warns ABOVE the money when the MPG the figures rest on is impossible", async () => {
    period.value = fuelHole();
    const { w } = await mountPage();
    const t = w.text();
    expect(t).toContain("no tractor achieves");
    // …and the warning precedes the table, because a reader who reaches the dollars first has already
    // believed them.
    expect(t.indexOf("no tractor achieves")).toBeLessThan(t.indexOf("Owed"));
  });

  it("names the fuel as the missing side rather than blaming the mileage", async () => {
    period.value = fuelHole();
    const t = (await mountPage()).w.text();
    expect(t).toContain("The miles are real and the FUEL is missing");
  });

  it("says a quarter has never been pulled, which is not the same as no miles driven", async () => {
    period.value = { ...healthy(), neverFetched: true, summary: { ...healthy().summary, monthsFetched: 0 } };
    const t = (await mountPage()).w.text();
    expect(t).toContain("No jurisdiction miles have been pulled");
    expect(t).toContain("needs a backfill");
  });

  // ── denominators, stated ──────────────────────────────────────────────────────────────────────
  it("names a jurisdiction it cannot price rather than dropping its miles", async () => {
    period.value = {
      ...healthy(),
      position: computeIftaPosition([miles("TX", 35_000), miles("ON", 35_000)], [bought("TX", 10_000)], "2026-05-15"),
    };
    const t = (await mountPage()).w.text();
    expect(t).toContain("ON cannot be");
    expect(t).toContain("of miles in jurisdictions this product can price");
  });

  it("keeps a return-billed surcharge out of the net and says so", async () => {
    period.value = {
      ...healthy(),
      position: computeIftaPosition([miles("KY", 70_000)], [bought("KY", 10_000)], "2026-05-15"),
    };
    const t = (await mountPage()).w.text();
    expect(t).toContain("not creditable and is not in the net above");
  });

  it("explains Samsara's own shortfall in words rather than as four integers", async () => {
    period.value = {
      ...healthy(),
      summary: { ...healthy().summary, troubleshooting: { unassignedFuelTypeVehicles: 187, noPurchasesFound: false } },
    };
    const t = (await mountPage()).w.text();
    expect(t).toContain("187 vehicles have no fuel type set in Samsara");
    expect(t).toContain("The credit side below is ours");
  });

  it("says when a month is still provisional, because the figures can still move", async () => {
    period.value = { ...healthy(), summary: { ...healthy().summary, anyProvisional: true } };
    expect((await mountPage()).w.text()).toContain("still provisional");
  });

  // ── the quarter lives in the URL ──────────────────────────────────────────────────────────────
  it("opens on the quarter the link names, so a filing can be sent to somebody", async () => {
    const t = (await mountPage("?q=2026-Q1")).w.text();
    expect(t).toContain("Q1 2026");
  });

  it("falls back to the current quarter for a link that names none", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toMatch(/Q[1-4] \d{4}/);
  });

  it("is honest that this is not a filed return", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toContain("This is a working view, not a filed return");
  });

  it("renders the error state rather than a blank page", async () => {
    errored.value = true;
    period.value = null;
    expect((await mountPage()).w.text()).toContain("Couldn't load this quarter");
  });

  // ── the return as a file (IP9) ──────────────────────────────────────────────────────────────────
  it("exports the quarter the page is showing, as Excel and as PDF", async () => {
    download.mockClear();
    const { w } = await mountPage("?q=2026-Q1");
    expect(w.find('[data-testid="export-ifta-xlsx"]').text()).toContain("Q1 2026");
    await w.find('[data-testid="export-ifta-xlsx"] button').trigger("click");
    await w.find('[data-testid="export-ifta-pdf"] button').trigger("click");
    await flushPromises();
    expect(download.mock.calls).toEqual([
      ["/api/ifta/return.xlsx?year=2026&quarter=1", "ifta-return-2026-Q1.xlsx"],
      ["/api/ifta/return.pdf?year=2026&quarter=1", "ifta-return-2026-Q1.pdf"],
    ]);
  });

  // ── a row opens the trucks behind it ──────────────────────────────────────────────────────────
  it("links each jurisdiction to its trucks for the SAME quarter, so the drill-down matches the row", async () => {
    const { w } = await mountPage("?q=2026-Q1");
    const texas = w.findAll("a").find((a) => a.text() === "Texas");
    expect(texas?.attributes("href")).toBe("/ifta/TX?q=2026-Q1");
  });

  it("opens the jurisdiction when the row itself is clicked", async () => {
    const { w, router } = await mountPage("?q=2026-Q1");
    const push = vi.spyOn(router, "push");
    const row = w.findAll("tbody tr").find((tr) => tr.text().includes("California"));
    await row!.trigger("click");
    expect(push).toHaveBeenCalledWith({ path: "/ifta/CA", query: { q: "2026-Q1" } });
  });
});
