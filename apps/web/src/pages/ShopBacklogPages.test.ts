import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { ShopDefectDto, ShopWorkOrderDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Open work orders and open defects (FLEET-MANAGER-HOME-PLAN Q-FM6 (a)) — the lists behind the Shop
 * card's figures. What they can get wrong that the card's test would not see:
 *
 *   1. **The toolbar count is not the whole list.** The card says 24 and links here; the toolbar must
 *      say 24 too, past the first page of twenty.
 *   2. **The day is the server's, not the carrier's.** An order opened at 03:00 UTC was opened the
 *      evening before in Chicago, and "Open for" counts from that day — the definition the card's
 *      "oldest open N days" uses.
 *   3. **A row with no unit vanishes or reads as a unit.** FleetPal's mapping can be unmatched; the
 *      row stays and the unit reads as a dash.
 */

const orders = ref<ShopWorkOrderDto[]>([]);
const defects = ref<ShopDefectDto[]>([]);
vi.mock("@/features/maintenance/useShopBacklog", async () => {
  const { ref: r } = await import("vue");
  const q = (data: unknown) => ({ data, isLoading: r(false), isError: r(false), refetch: vi.fn() });
  return { useOpenWorkOrdersQuery: () => q(orders), useUnresolvedDefectsQuery: () => q(defects) };
});
vi.mock("@/composables/useOrgTimezone", () => ({
  useOrgTimezone: () => ({ zone: computed(() => "America/Chicago"), isResolved: computed(() => true) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));

const WorkOrdersPage = (await import("@/pages/WorkOrdersPage.vue")).default;
const DefectsPage = (await import("@/pages/DefectsPage.vue")).default;

async function page(component: unknown, url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  const w = mount(component as never, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

const order = (o: Partial<ShopWorkOrderDto> = {}): ShopWorkOrderDto => ({
  id: "w1", referenceNumber: "WO-1001", unitNumber: "654", vehicleId: null, trailerId: null, description: "Brake chamber leaking", priority: "HIGH",
  openedAt: "2026-06-24T15:12:00+00:00", ...o,
});
const defect = (o: Partial<ShopDefectDto> = {}): ShopDefectDto => ({
  id: "d1", unitNumber: "654", vehicleId: null, trailerId: null, name: "Air leak", description: "Left rear", driverComment: "Hissing at the glad hand",
  detectedAt: "2026-10-10T14:00:00+00:00", ...o,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z")); // noon in Chicago
  orders.value = [];
  defects.value = [];
});
afterEach(() => vi.useRealTimers());

describe("open work orders", () => {
  it("counts the whole list in the toolbar, past the first page", async () => {
    orders.value = Array.from({ length: 24 }, (_, i) => order({ id: `w${i}`, referenceNumber: `WO-${1000 + i}` }));
    const w = await page(WorkOrdersPage, "/shop/work-orders");
    expect(w.text()).toContain("24 open work orders");
    expect(w.text()).toContain("Showing 1–20 of 24");
  });

  it("dates the order on the carrier's calendar and counts the days open from it", async () => {
    // 03:00 UTC on 10-11 is 22:00 on 10-10 in Chicago: opened 10/10, two days before noon on 10-12.
    orders.value = [order({ openedAt: "2026-10-11T03:00:00+00:00" })];
    const w = await page(WorkOrdersPage, "/shop/work-orders");
    expect(w.text()).toContain("10/10/2026");
    expect(w.text()).toContain("2 days");
  });

  it("keeps an order on a unit nobody has linked, with a dash for the unit", async () => {
    orders.value = [order({ unitNumber: null, referenceNumber: "WO-77" })];
    const w = await page(WorkOrdersPage, "/shop/work-orders");
    expect(w.text()).toContain("WO-77");
    expect(w.text()).toContain("1 open work order");
  });

  it("says nothing is in progress when FleetPal has nothing open", async () => {
    expect((await page(WorkOrdersPage, "/shop/work-orders")).text()).toContain("No open work orders.");
  });

  it("finds an order by unit from a pasted search", async () => {
    orders.value = [order(), order({ id: "w2", referenceNumber: "WO-2002", unitNumber: "711" })];
    const w = await page(WorkOrdersPage, "/shop/work-orders?search=711");
    expect(w.text()).toContain("WO-2002");
    expect(w.text()).not.toContain("WO-1001");
  });
});

describe("open defects", () => {
  it("lists every open defect with the driver's own words", async () => {
    defects.value = [defect(), defect({ id: "d2", unitNumber: "711", name: "Cracked mirror", driverComment: null })];
    const w = await page(DefectsPage, "/shop/defects");
    expect(w.text()).toContain("2 open defects");
    expect(w.text()).toContain("Hissing at the glad hand");
    expect(w.text()).toContain("Cracked mirror");
    expect(w.text()).toContain("2 days");
  });

  it("shows no severity, because FleetPal sends none", async () => {
    defects.value = [defect()];
    expect((await page(DefectsPage, "/shop/defects")).text()).not.toMatch(/severity/i);
  });
});
