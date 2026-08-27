import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { computed, ref } from "vue";
import { computeIftaPosition, tieOutMiles, type IftaFuelPurchase, type IftaJurisdictionMiles } from "@silvicom/shared";
import { metersFromMiles } from "@silvicom/shared";
import type { IftaPeriodData } from "@/features/ifta/useIftaPeriod";

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
    routes: [{ path: "/ifta", name: "ifta", component: { template: "<div/>" }, meta: { title: "IFTA" } }],
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
});
