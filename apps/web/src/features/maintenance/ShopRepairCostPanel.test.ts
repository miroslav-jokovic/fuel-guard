import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { CoverageMonth, RollupAnswer } from "@silvicom/shared";

/**
 * The Shop's Repair cost tab (FLEETPAL-INTEGRATION-PLAN.md F9d). The hook runs for real over a stubbed
 * `apiFetch`, so these pin what the reader sees AND what the page asks for:
 *
 *   1. It opens on the newest printable run of months — never on the current month, which refuses.
 *   2. A 409 prints the API's own sentence, which names the month, instead of a figure or an error.
 *   3. Both values are named, the bound says "at least", and the unmatched count is on the page.
 *   4. One table at a time (contract §9 rule 9): periods by default, units by `?view=units`, paged.
 *   5. A truck's row opens its page; an unmatched FleetPal unit's opens nothing.
 */
const cov = (month: string, ratio: number | null): CoverageMonth => ({
  month, fleetpalInvoiced: 0, glMaintenance: ratio === null ? null : 1, confirmedInLedger: 0, ratioLowerBound: ratio,
  matchedExactlyOne: 0, matchedSeveral: 0, matchedNone: 0, amountDiffers: 0,
});
const money = (operational: number | null, external: number | null, repairs = 1) => ({ operational, external, repairs, unpriced: 0 });
const ANSWER: RollupAnswer = {
  buckets: [
    { key: "2026-09", from: "2026-09-01", to: "2026-10-01", months: ["2026-09"], fleet: money(1000, 700, 2),
      byKind: { tractor: money(800, 600), trailer: money(150, 80), unmatched: money(50, 20) } },
    { key: "2026-10", from: "2026-10-01", to: "2026-11-01", months: ["2026-10"], fleet: money(500, 400),
      byKind: { tractor: money(500, 400), trailer: money(null, null, 0), unmatched: money(null, null, 0) } },
  ],
  units: [
    { fleetpalUnitIds: ["u1"], kind: "tractor", label: "777", vehicleId: "veh-777", trailerId: null, total: money(1300, 1000), buckets: {} },
    { fleetpalUnitIds: ["u9"], kind: "unmatched", label: "SOLD", vehicleId: null, trailerId: null, total: money(50, 20), buckets: {} },
  ],
  unitTotal: 2,
  coverage: [cov("2026-09", 0.412), cov("2026-10", 0.38)],
  unmatchedUnits: 48,
};

const api = vi.hoisted(() => ({ calls: [] as string[], refuse: false }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.calls.push(path);
    if (path.startsWith("/api/maintenance/fleetpal/coverage")) {
      return { ok: true, data: { months: [cov("2026-08", null), cov("2026-09", 0.412), cov("2026-10", 0.38), cov("2026-11", null)] } };
    }
    if (api.refuse) {
      return { ok: false, error: { code: "coverage_unavailable", message: "Repair cost cannot be shown for this window: the general ledger has no swept maintenance total for 2026-11, so there is nothing to measure FleetPal's share against." } };
    }
    return { ok: true, data: ANSWER };
  }),
}));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

const Panel = (await import("./ShopRepairCostPanel.vue")).default;

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/shop", component: { template: "<div />" } }, { path: "/shop/units/:kind/:id", component: { template: "<div />" } }] });
  await router.push(url);
  await router.isReady();
  const w = mount(Panel, { global: { plugins: [router, createPinia(), [VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  await flushPromises();
  return { w, router };
}
const rollupCall = () => new URLSearchParams(api.calls.find((c) => c.startsWith("/api/maintenance/fleetpal/rollup"))!.split("?")[1]);

beforeEach(() => {
  api.calls.length = 0;
  api.refuse = false;
});

describe("Repair cost", () => {
  it("opens on the newest printable months, ending before the unswept current month", async () => {
    await mountAt("/shop?tab=cost");
    const p = rollupCall();
    expect([p.get("from"), p.get("to"), p.get("bucket"), p.get("kind"), p.get("offset")]).toEqual(["2026-09-01", "2026-11-01", "month", "all", "0"]);
  });

  it("asks for the window, period and units the URL names, and the page's offset", async () => {
    await mountAt("/shop?tab=cost&from=2026-10-05&to=2026-10-18&bucket=week&kind=tractor&page=2");
    const p = rollupCall();
    expect([p.get("from"), p.get("to"), p.get("bucket"), p.get("kind"), p.get("offset")]).toEqual(["2026-10-05", "2026-10-19", "week", "tractor", "25"]);
  });

  it("prints the refusal's own sentence, naming the month, and no figure", async () => {
    api.refuse = true;
    const { w } = await mountAt("/shop?tab=cost&from=2026-11-01&to=2026-11-15");
    expect(w.find('[data-test="repair-cost-unavailable"]').text()).toContain("2026-11");
    expect(w.text()).not.toContain("$");
  });

  it("names both values, says 'at least', and counts the unmatched units", async () => {
    const { w } = await mountAt("/shop?tab=cost");
    const text = w.text();
    expect(text).toContain("With shop labour");
    expect(text).toContain("Without labour (comparable to the ledger)");
    expect(text).toContain("$1,500"); // the window's total with labour: 1,000 + 500
    expect(text).toContain("$1,100"); // and without
    expect(text).toContain("at least 41%");
    expect(text).toContain("48 FleetPal units not matched to a truck or trailer");
  });

  it("draws one table at a time: periods by default, units when the URL asks", async () => {
    const periods = (await mountAt("/shop?tab=cost")).w;
    expect(periods.findAll("table").length).toBeLessThanOrEqual(1);
    expect(periods.find('[aria-label="Repair cost by unit"]').exists()).toBe(false);
    expect(periods.text()).toContain("October 2026");
    const units = (await mountAt("/shop?tab=cost&view=units")).w;
    expect(units.find('[aria-label="Repair cost by period"]').exists()).toBe(false);
    expect(units.text()).toContain("Showing 1");
  });

  it("opens a truck's page from its row, and nothing from an unmatched unit's", async () => {
    const { w, router } = await mountAt("/shop?tab=cost&view=units");
    const unitTable = w.find('[aria-label="Repair cost by unit"]');
    expect(unitTable.find('a[href="/shop/units/tractor/veh-777"]').exists()).toBe(true);
    expect(unitTable.text()).toContain("SOLD");
    expect(unitTable.findAll("a").map((a) => a.attributes("href"))).toEqual(["/shop/units/tractor/veh-777"]);
    await unitTable.find('a[href="/shop/units/tractor/veh-777"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/shop/units/tractor/veh-777");
  });
});
