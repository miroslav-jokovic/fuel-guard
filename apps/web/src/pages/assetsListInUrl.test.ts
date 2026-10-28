import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref, type Ref } from "vue";
import { ROUTE_TABLE } from "@/router/table";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — a filtered list keeps its filters and page in the URL.
 *
 * Assets is a SERVER-paged list, so what has to survive a reload is not a client filter but the
 * request: the URL is read back into the filter `useAssetsQuery` is handed. And `?new=1` — the drawer
 * a link may open — is a flag in the same buffer, so closing the drawer removes `new` and nothing else.
 */

let lastFilter: Ref<Record<string, unknown>>;
vi.mock("@/features/inventory/useAssets", () => ({
  ASSETS_PAGE_SIZE: 50,
  useAssetsQuery: (filter: Ref<Record<string, unknown>>) => {
    lastFilter = filter;
    return { data: ref({ assets: [], total: 120 }), isLoading: ref(false), isError: ref(false), refetch: vi.fn() };
  },
  useAssetTypesQuery: () => ({ data: ref([{ id: "type-tablet", name: "Tablet" }]) }),
}));
// The page's On trucks count reads the fleet's kit (M7); empty here, the Inventory tab is under test.
vi.mock("@/features/inventory/useUnits", () => ({
  useUnitsQuery: () => ({ data: ref({ units: [], total: 0 }), isLoading: ref(false), isError: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
// DataTable swaps to cards below 768px and jsdom has no matchMedia; the desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import AssetsPage from "./AssetsPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

let router: Router;
async function mountAt(url: string) {
  router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  const w = mount(AssetsPage, {
    global: { plugins: [router, createPinia()], stubs: { AssetDrawer: true, AssetTypesDrawer: true, KitRulesDrawer: true, KebabMenu: true } },
  });
  await flushPromises();
  return w;
}
type Mounted = Awaited<ReturnType<typeof mountAt>>;
const select = (w: Mounted, label: string) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === label)!;
const query = () => router.currentRoute.value.query;

beforeEach(() => vi.clearAllMocks());

describe("Assets keeps its list in the URL", () => {
  it("reads filters and page from a pasted link into the request it sends", async () => {
    const w = await mountAt("/shop/assets?tab=inventory&status=in_repair&kind=type-tablet&search=A-04&page=2");
    expect(select(w, "Status").props("modelValue")).toBe("in_repair");
    expect(select(w, "Kind").props("modelValue")).toBe("type-tablet");
    expect(lastFilter.value).toEqual({ search: "A-04", status: "in_repair", assetTypeId: "type-tablet", page: 2 });
  });

  it("reads a status outside the catalogue as none, so a hand-edited link never reaches the API", async () => {
    await mountAt("/shop/assets?tab=inventory&status=stolen");
    expect(lastFilter.value.status).toBeUndefined();
  });

  it("writes a filter to the URL and returns to page 1", async () => {
    const w = await mountAt("/shop/assets?tab=inventory&page=3");
    select(w, "Status").vm.$emit("update:modelValue", "spare");
    await flushPromises();
    expect(query()).toEqual({ tab: "inventory", status: "spare" });
  });

  it("Clear filters empties every filter", async () => {
    const w = await mountAt("/shop/assets?tab=inventory&status=lost&kind=type-tablet&search=x&page=2");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ tab: "inventory" });
  });

  it("opens the drawer from ?new=1, and closing it keeps the filters", async () => {
    const w = await mountAt("/shop/assets?tab=inventory&status=lost&new=1");
    const drawer = w.findComponent({ name: "AssetDrawer" });
    expect(drawer.props("open")).toBe(true);
    drawer.vm.$emit("close");
    await flushPromises();
    expect(query()).toEqual({ tab: "inventory", status: "lost" });
  });
});
