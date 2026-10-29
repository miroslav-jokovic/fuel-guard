import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";

/**
 * Types of equipment › *Who holds one* (DE2b; D-DE1). The owner flips Tablet to "A driver" here, once,
 * and nothing else in the product can — so the two things pinned are that the choice reaches the API
 * as `heldBy`, and that 0524's refusal (`held_by_conflict`) lands beside the choice in the API's own
 * words instead of a toast that says "could not save" and leaves the person guessing why.
 */
const { update, toastError } = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  return {
    update: { isPending: ref(false), mutateAsync: vi.fn(async (_input: unknown) => ({})) },
    toastError: vi.fn(),
  };
});

vi.mock("./useAssets", async () => {
  const { ref } = await import("vue");
  const idle = () => ({ isPending: ref(false), mutateAsync: vi.fn() });
  return {
    useAssetTypesQuery: () => ({
      data: ref([
        { id: "t1", name: "Tablet", category: "Electronics", serialized: true, defaultKitQuantity: 1, imagePath: null, heldBy: "unit" },
      ]),
      isLoading: ref(false),
      isError: ref(false),
      isFetching: ref(false),
      refetch: () => {},
    }),
    useCreateAssetType: idle,
    useUpdateAssetType: () => update,
    useAdoptStandardKit: idle,
  };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: toastError }) }));

import AssetTypesDrawer from "./AssetTypesDrawer.vue";

const SlideOver = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const render = () => mount(AssetTypesDrawer, { props: { open: true }, attachTo: document.body, global: { stubs: { SlideOver } } });
type W = ReturnType<typeof render>;

async function editTabletToDriver(w: W) {
  await w.findAll("button").find((b) => b.text() === "Edit")!.trigger("click");
  await w.findAll("button").find((b) => b.text() === "A driver (tablets)")!.trigger("click");
  await w.find("form").trigger("submit");
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  setActivePinia(createPinia());
  update.mutateAsync.mockReset();
  update.mutateAsync.mockResolvedValue({});
  toastError.mockReset();
});

describe("who holds a type (DE2b)", () => {
  it("opens an edit on the type's own answer, so saving an untouched type keeps it", async () => {
    const w = render();
    await w.findAll("button").find((b) => b.text() === "Edit")!.trigger("click");
    await w.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));
    expect(update.mutateAsync).toHaveBeenCalledWith({ id: "t1", patch: expect.objectContaining({ heldBy: "unit" }) });
    w.unmount();
  });

  it("sends the new answer as heldBy", async () => {
    const w = render();
    await editTabletToDriver(w);
    expect(update.mutateAsync).toHaveBeenCalledWith({ id: "t1", patch: expect.objectContaining({ heldBy: "driver" }) });
    w.unmount();
  });

  it("shows held_by_conflict's sentence beside the choice, not as a toast", async () => {
    const said = "Some of these are on a truck or trailer. Move them to the shop first, then change who holds them.";
    update.mutateAsync.mockRejectedValue(Object.assign(new Error(said), { code: "held_by_conflict" }));
    const w = render();
    await editTabletToDriver(w);
    expect(w.text()).toContain(said);
    expect(toastError).not.toHaveBeenCalled();
    w.unmount();
  });

  it("still toasts any other failure", async () => {
    update.mutateAsync.mockRejectedValue(Object.assign(new Error("boom"), { code: "db_error" }));
    const w = render();
    await editTabletToDriver(w);
    expect(toastError).toHaveBeenCalledWith("Could not save the type", "boom");
    w.unmount();
  });
});
