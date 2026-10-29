import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AssetCreateInput } from "@silvicom/shared";

/**
 * M9b — "Save and add another": a box of ten tablets is ten sticker scans, not ten drawers. After a
 * save the drawer stays open on a fresh form that keeps what the box shares and clears what each
 * tablet has of its own. A plain "Add asset" after a failed "add another" must still close.
 */
const created: AssetCreateInput[] = [];
vi.mock("./useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    useAssetTypesQuery: () => ({ data: r([]) }),
    useCreateAsset: () => ({
      isPending: r(false),
      mutateAsync: async (input: AssetCreateInput) => {
        created.push(input);
        return { id: `a-${created.length}`, displayNo: `A-000${created.length}` };
      },
    }),
    useUpdateAsset: () => ({ isPending: r(false), mutateAsync: vi.fn() }),
  };
});
vi.mock("./useInventory", async () => ({ useLocationsQuery: () => ({ data: ref([]) }) }));

const AssetDrawer = (await import("./AssetDrawer.vue")).default;
const AssetForm = (await import("./AssetForm.vue")).default;

const TABLET = "11111111-1111-4111-8111-111111111111";
const input = (over: Partial<AssetCreateInput> = {}): AssetCreateInput =>
  ({
    assetTypeId: TABLET, name: "Samsung SM-T575", serialNumber: "R52W40ABCDE", imei: "490154203237518",
    model: "SM-T575", manufacturer: "Samsung", status: "in_service", condition: "good",
    purchasedAt: "2026-10-20", purchaseCost: 389, warrantyExpiresAt: null, notes: "Box 1", locationId: null, ...over,
  }) as AssetCreateInput;

const mountDrawer = () =>
  mount(AssetDrawer, { props: { open: true }, global: { stubs: { SlideOver: { template: "<div><slot /><slot name='footer' /></div>" } } } });

beforeEach(() => {
  setActivePinia(createPinia());
  created.length = 0;
});

describe("Save and add another", () => {
  it("stays open on a fresh form that keeps the box's facts and clears the tablet's own", async () => {
    const w = mountDrawer();
    await w.find('[data-test="save-another"]').trigger("click");
    w.findComponent(AssetForm).vm.$emit("submit", input());
    await flushPromises();

    expect(created).toHaveLength(1);
    expect(w.emitted("close")).toBeUndefined();
    expect(w.findComponent(AssetForm).props("initial")).toEqual({
      assetTypeId: TABLET, model: "SM-T575", manufacturer: "Samsung", locationId: "",
      purchasedAt: "2026-10-20", purchaseCost: "389", warrantyExpiresAt: "",
    });
  });

  it("closes on a plain Add asset, even after an Add another that did not go through", async () => {
    const w = mountDrawer();
    await w.find('[data-test="save-another"]').trigger("click");
    // The form refused (nothing emitted); the person then presses the plain button.
    await w.findAll("button").find((b) => b.text() === "Add asset")!.trigger("click");
    w.findComponent(AssetForm).vm.$emit("submit", input());
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
  });
});
