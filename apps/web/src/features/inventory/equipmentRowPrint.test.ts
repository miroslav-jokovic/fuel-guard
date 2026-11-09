import { describe, expect, it, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * Every Equipment tab's row menu has Print label (owner 2026-11-09), naming that row's own label
 * target — an asset for Drivers and Shop, the truck's or trailer's TABLE for Trucks — and it is hidden
 * from a person who may not print (the print route asks `maintenance` manage).
 */

const printOne = vi.hoisted(() => vi.fn());
vi.mock("@/composables/usePrinting", () => ({ usePrintOneLabel: () => ({ printOne }) }));
const session = vi.hoisted(() => ({ manage: true }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: () => session.manage, canView: () => true, canManage: session.manage }),
}));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

const ASSET = {
  id: "11111111-1111-4111-8111-111111111111",
  displayNo: "A-0412",
  name: "Tablet",
  assetTypeName: "Tablet",
  status: "in_service",
  holder: { kind: "shop", id: null, label: "Shop" },
  imei: null,
};
vi.mock("@/features/inventory/useAssets", () => ({
  ASSETS_PAGE_SIZE: 50,
  useAssetsQuery: () => ({ data: ref({ assets: [ASSET], total: 1 }), isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() }),
  useAssetTypesQuery: () => ({ data: ref([]) }),
  useNotReturnedCountQuery: () => ({ data: ref(0) }),
}));
const UNIT = { unitId: "22222222-2222-4222-8222-222222222222", unitNumber: "233210", kind: "reefer_trailer", lines: [{ held: 1 }], shortBy: 0, lastCheckedAt: null };
vi.mock("@/features/inventory/useUnits", () => ({
  useUnitsQuery: () => ({ data: ref({ units: [UNIT], total: 1 }), isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() }),
}));

import EquipmentInventoryPanel from "./EquipmentInventoryPanel.vue";
import EquipmentDriversPanel from "./EquipmentDriversPanel.vue";
import EquipmentOnTrucksPanel from "./EquipmentOnTrucksPanel.vue";

async function mountPanel(component: object) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/shop/assets");
  await router.isReady();
  const w = mount(component, {
    global: { plugins: [router], stubs: { KebabMenu: { template: "<div><slot /></div>" } } },
  });
  await flushPromises();
  return w;
}
const printButton = (w: Awaited<ReturnType<typeof mountPanel>>) => w.findAll("button").find((b) => b.text() === "Print label");

beforeEach(() => {
  session.manage = true;
  printOne.mockClear();
});

describe("Equipment row menu — Print label", () => {
  it("Shop: prints that asset's label", async () => {
    const w = await mountPanel(EquipmentInventoryPanel);
    await printButton(w)!.trigger("click");
    expect(printOne).toHaveBeenCalledWith({ kind: "asset", assetId: ASSET.id });
  });

  it("Drivers: prints that asset's label", async () => {
    const w = await mountPanel(EquipmentDriversPanel);
    await printButton(w)!.trigger("click");
    expect(printOne).toHaveBeenCalledWith({ kind: "asset", assetId: ASSET.id });
  });

  it("Trucks: a reefer prints as a trailers row, its table", async () => {
    const w = await mountPanel(EquipmentOnTrucksPanel);
    await printButton(w)!.trigger("click");
    expect(printOne).toHaveBeenCalledWith({ kind: "unit", unitKind: "trailer", unitId: UNIT.unitId });
  });

  it("is not offered to someone who may not print", async () => {
    session.manage = false;
    for (const panel of [EquipmentInventoryPanel, EquipmentDriversPanel, EquipmentOnTrucksPanel]) {
      expect(printButton(await mountPanel(panel))).toBeUndefined();
    }
  });
});
