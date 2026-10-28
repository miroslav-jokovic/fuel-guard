import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive, ref } from "vue";
import type { AnnualDueDto, RoadsideRepairDueDto, ShopDefectDto, ShopWorkOrderDto } from "@silvicom/shared";

/**
 * The Shop page as one list a tab (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.3, M6). Each tab's list is
 * its panel's, tested beside it (`ShopBacklogPanels`, `RoadsideRepairsPanel`, `repairBillsListInUrl`);
 * this pins what only the page decides:
 *
 *   1. **Which tab it opens on** — the URL's, else the first with rows in deadline order, else Defects.
 *   2. **A tab the reader cannot open is not drawn** — each tab answers to its old screen's grant (SP5),
 *      so a per-person denial still closes the list it closed before M6.
 *   3. **The counts on the tabs** are the lists' own, and a tab with nothing carries no zero.
 *   4. **Switching tabs drops the last list's search and page** — they belong to a different list.
 */
const defects = ref<ShopDefectDto[] | undefined>([]);
const orders = ref<ShopWorkOrderDto[] | undefined>([]);
const annual = ref<AnnualDueDto[] | undefined>([]);
const repairs = ref<RoadsideRepairDueDto[] | undefined>([]);
const q = (data: unknown) => ({ data, isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() });

vi.mock("@/features/maintenance/useShopBacklog", () => ({
  useUnresolvedDefectsQuery: () => q(defects),
  useOpenWorkOrdersQuery: () => q(orders),
  useAnnualDueQuery: () => q(annual),
}));
vi.mock("@/features/roadside/useRoadsideInspections", () => ({ useRoadsideRepairsDueQuery: () => q(repairs) }));
/** Screens closed to this reader (SP5). */
const closed = new Set<string>();
vi.mock("@/composables/useOpens", () => ({ useOpens: () => (to: string) => !closed.has(to) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("technician");
  return { useSessionStore: () => s, __session: s };
});
const route = reactive({ query: {} as Record<string, string>, params: {}, meta: { title: "Shop" }, matched: [], path: "/shop" });
const replaced: unknown[] = [];
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => route,
    useRouter: () => ({
      push: vi.fn(),
      replace: (to: { query: Record<string, string> }) => {
        replaced.push(to);
        route.query = to.query;
      },
      resolve: () => ({ name: "not-found", meta: {} }),
    }),
  };
});

const HomePage = (await import("@/pages/MaintenanceHomePage.vue")).default;
const PANELS = ["RoadsideRepairsPanel", "ShopDefectsPanel", "ShopWorkOrdersPanel", "ShopAnnualDuePanel", "ShopRepairBillsPanel"];
const page = () =>
  mount(HomePage, {
    global: { stubs: { ...Object.fromEntries(PANELS.map((n) => [n, { template: `<div data-test="${n}" />` }])), PageHeader: { template: "<header><slot name='actions' /></header>" } } },
  });
const tabLabels = (w: ReturnType<typeof page>) => w.findAll("[role=tab]").map((t) => t.text().replace(/\s+/g, " ").trim());
const panel = (w: ReturnType<typeof page>) => PANELS.find((n) => w.find(`[data-test="${n}"]`).exists());

const defect = { id: "d1", unitNumber: "654", name: "Air leak" } as ShopDefectDto;
const order = { id: "w1", referenceNumber: "WO-1", unitNumber: "720" } as ShopWorkOrderDto;
const repair = { unitId: "u1", decision: null, proposal: { outcome: "needs_repair", candidates: [] } } as unknown as RoadsideRepairDueDto;

beforeEach(() => {
  setActivePinia(createPinia());
  defects.value = [];
  orders.value = [];
  annual.value = [];
  repairs.value = [];
  closed.clear();
  replaced.length = 0;
  route.query = {};
});

describe("which tab the Shop page opens on", () => {
  it("opens on Defects on a quiet day, where its empty sentence says so", () => {
    expect(panel(page())).toBe("ShopDefectsPanel");
  });

  it("opens on the first tab with rows, in deadline order", () => {
    orders.value = [order];
    expect(panel(page())).toBe("ShopWorkOrdersPanel");
    defects.value = [defect];
    expect(panel(page())).toBe("ShopDefectsPanel");
    repairs.value = [repair];
    expect(panel(page())).toBe("RoadsideRepairsPanel");
  });

  it("opens on the tab the URL names, rows or not", () => {
    defects.value = [defect];
    route.query = { tab: "bills" };
    expect(panel(page())).toBe("ShopRepairBillsPanel");
  });

  it("ignores a tab the reader cannot open, even when the URL names it", () => {
    closed.add("/shop/repair-spend");
    route.query = { tab: "bills" };
    const w = page();
    expect(panel(w)).toBe("ShopDefectsPanel");
    expect(tabLabels(w)).not.toContain("Repair bills");
  });
});

describe("the tabs", () => {
  it("are the five lists, in deadline order, each with its own count and no zero", () => {
    defects.value = [defect, { ...defect, id: "d2" }];
    orders.value = [order];
    expect(tabLabels(page())).toEqual(["Roadside repairs", "Defects 2", "Work orders 1", "Annual due", "Repair bills"]);
  });

  it("counts only the roadside repairs still open", () => {
    repairs.value = [repair, { ...repair, unitId: "u2", decision: { decidedAt: "2026-10-01" } } as unknown as RoadsideRepairDueDto];
    expect(tabLabels(page())[0]).toBe("Roadside repairs 1");
  });

  it("draws no tab whose screen is closed to this reader (SP5)", () => {
    closed.add("/shop/defects");
    closed.add("/shop/roadside-repairs");
    expect(tabLabels(page())).toEqual(["Work orders", "Annual due", "Repair bills"]);
  });

  it("drops the last list's search, sort and page when another tab is picked", async () => {
    route.query = { tab: "defects", search: "654", page: "3" };
    const w = page();
    await w.findAll("[role=tab]").find((t) => t.text().startsWith("Work orders"))!.trigger("click");
    expect(replaced.at(-1)).toEqual({ query: { tab: "work-orders" } });
  });
});
