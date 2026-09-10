import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref, type Ref } from "vue";
import type { ScanResult } from "@silvicom/shared";

/**
 * Scan → resolve → verb → write, joined up (INVENTORY-PLAN.md I6).
 *
 * ── WHY A PAGE TEST AND NOT THREE MORE UNIT TESTS ─────────────────────────────────────────────
 * `useScanInput` is pinned on its own and the drawers are pinned on theirs, and that has twice not
 * been enough on this feature: the 2026-09-09 close-out found a fresh org's entire asset half
 * unreachable because `POST /asset-types` had no screen, with every gate green and every suite
 * passing, "because each layer is correct in isolation; what was missing was the join between
 * them". This file is the join — the wiring between the keystrokes, the resolve and the drawer,
 * which is the only place the three meet and the only place that failure lives.
 */

const CRIB = "11111111-1111-4111-8111-111111111111";
const PART = "22222222-2222-4222-8222-222222222222";

const BIN_TAG = "SIL1:BIN:7K3M9P";
const STRANGE_BARCODE = "0049000042566";

const STOCK_LINE = {
  partId: PART,
  locationId: CRIB,
  partNumber: "P-100",
  partDescription: "Oil filter",
  locationName: "Tool crib",
  unitOfMeasure: "each" as const,
  quantityOnHand: 11,
  reorderPoint: null,
  reorderQuantity: null,
  tagCode: "7K3M9P",
  lastCost: null,
  aisle: null,
  row: null,
  bin: null,
  active: true,
};

const RESULTS: Record<string, ScanResult> = {
  [BIN_TAG]: { kind: "stock_line", code: BIN_TAG, stockLine: STOCK_LINE },
  [STRANGE_BARCODE]: { kind: "malformed", code: STRANGE_BARCODE },
};

/** The ref the page hands to `useScanQuery` — the test reads it to see what was submitted. */
const submitted = { code: null as Ref<string> | null };
const refetch = vi.fn();

vi.mock("@/features/inventory/useScan", () => ({
  useScanQuery: (code: Ref<string>) => {
    submitted.code = code;
    return {
      data: computed(() => RESULTS[code.value]),
      isFetching: ref(false),
      isError: ref(false),
      error: ref(null),
      refetch,
    };
  },
}));

vi.mock("@/features/inventory/useInventory", () => ({
  useLocationsQuery: () => ({
    data: ref([{ id: CRIB, name: "Tool crib", code: "CRIB", address: null, active: true }]),
  }),
}));

const drawerStub = (name: string, props: string[]) => ({
  name,
  props: [...props, "open"],
  template: "<div />",
});

const ScanPage = (await import("@/pages/ScanPage.vue")).default;

function render() {
  return mount(ScanPage, {
    global: {
      stubs: {
        Teleport: true,
        MovementDrawer: drawerStub("MovementDrawer", ["verb", "line", "locations"]),
        AssetMoveDrawer: drawerStub("AssetMoveDrawer", ["asset", "mode", "locations"]),
        PartDrawer: drawerStub("PartDrawer", ["part", "initialUpc"]),
      },
    },
  });
}

/** Type a whole code at machine speed and terminate it the way a scanner does. */
function scan(code: string) {
  for (const char of code) document.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

describe("ScanPage", () => {
  beforeEach(() => {
    submitted.code = null;
    refetch.mockClear();
  });

  it("resolves what the scanner reads and offers the shelf's verbs", async () => {
    const wrapper = render();

    scan(BIN_TAG);
    await wrapper.vm.$nextTick();

    expect(submitted.code?.value).toBe(BIN_TAG);
    expect(wrapper.text()).toContain("Oil filter");
    expect(wrapper.text()).toContain("Tool crib");
    expect(wrapper.text()).toContain("Issue");
  });

  it("opens the desk's own movement drawer on the shelf that was scanned", async () => {
    const wrapper = render();
    scan(BIN_TAG);
    await wrapper.vm.$nextTick();

    await wrapper.findAll("button").find((b) => b.text() === "Issue")!.trigger("click");

    const drawer = wrapper.findComponent({ name: "MovementDrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("verb")).toBe("issued");
    expect(drawer.props("line")).toMatchObject({ partNumber: "P-100", locationId: CRIB });
  });

  /**
   * ⚠ THE ASSERTION THIS FILE EXISTS FOR. A scanner in a technician's hand does not know a form is
   * open, and a stray trigger pull while an issue is half filled in would swap the item under the
   * quantity they have already typed — a wrong write, recorded silently, against a part they were
   * not looking at. The guard is one `enabled` computed on the page and nothing else in the repo
   * can see it break.
   */
  it("stops listening to the scanner while a drawer is open", async () => {
    const wrapper = render();
    scan(BIN_TAG);
    await wrapper.vm.$nextTick();
    await wrapper.findAll("button").find((b) => b.text() === "Issue")!.trigger("click");

    scan(STRANGE_BARCODE);
    await wrapper.vm.$nextTick();

    expect(submitted.code?.value).toBe(BIN_TAG);
    expect(wrapper.findComponent({ name: "MovementDrawer" }).props("line")).toMatchObject({
      partNumber: "P-100",
    });
  });

  /**
   * The receiving desk's most common scan of all: a carton from a supplier the shop has never bought
   * from. Research §2.5 found that what the good products do here is "attach or create" with the code
   * KEPT — so the barcode has to reach the form, because the alternative is reading thirteen digits
   * off one part of the screen and typing them into another with the carton in the other hand.
   */
  it("carries an unrecognised barcode into the new-part form", async () => {
    const wrapper = render();
    scan(STRANGE_BARCODE);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Not recognised");
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("Create a part"))!
      .trigger("click");

    expect(wrapper.findComponent({ name: "PartDrawer" }).props("initialUpc")).toBe(STRANGE_BARCODE);
  });

  /**
   * The on-hand on screen is the figure from BEFORE the issue that just closed. Re-scanning would be
   * the honest refresh and it is one trigger pull, but a technician watching eleven stay eleven after
   * taking two is a technician who counts the shelf by hand to find out which number was right.
   */
  it("asks the server again once a write has closed", async () => {
    const wrapper = render();
    scan(BIN_TAG);
    await wrapper.vm.$nextTick();
    await wrapper.findAll("button").find((b) => b.text() === "Issue")!.trigger("click");

    wrapper.findComponent({ name: "MovementDrawer" }).vm.$emit("close");
    await wrapper.vm.$nextTick();

    expect(refetch).toHaveBeenCalled();
    expect(wrapper.findComponent({ name: "MovementDrawer" }).exists()).toBe(false);
  });
});
