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
/** `SIL1:BIN:7K3M9P` through a non-US keyboard layout: every colon became `Ñ`. */
const MISREAD_TAG = "SIL1ÑBINÑ7K3M9P";
/** M9b: a tablet's IMEI that no equipment has, and the same fifteen digits misread. */
const NEW_IMEI = "490154203237518";
const BAD_IMEI = "490154203237519";

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
  [MISREAD_TAG]: { kind: "unknown_tag", code: MISREAD_TAG, tagKind: null },
  [NEW_IMEI]: { kind: "malformed", code: NEW_IMEI },
  [BAD_IMEI]: { kind: "malformed", code: BAD_IMEI },
};

/** The ref the page hands to `useScanQuery` — the test reads it to see what was submitted. */
const submitted = { code: null as Ref<string> | null, seq: null as Ref<number> | null };
/** The session's answer to "may this member write to maintenance". */
const manage = ref(true);

vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => manage.value }) }));
const refetch = vi.fn();

vi.mock("@/features/inventory/useScan", () => ({
  useScanQuery: (code: Ref<string>, seq: Ref<number>) => {
    submitted.code = code;
    submitted.seq = seq;
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
        AssetDrawer: drawerStub("AssetDrawer", ["initial"]),
        // `once` typed Boolean, as the component types it, or a bare attribute reads as "".
        BarcodeCamera: { name: "BarcodeCamera", props: { reader: Object, once: Boolean, title: String, hint: String }, template: "<div />" },
      },
    },
  });
}

/** Type a whole code at machine speed and terminate it the way a scanner does. */
function scan(code: string) {
  for (const char of code) document.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

/**
 * The page inside its REAL layout, Teleport not stubbed. `ShopLayout` draws `#shop-action-bar` after
 * the page, and until 2026-10-29 the page's Teleport looked for it too early: in a build the typed
 * fallback never mounted and every drawer on this page failed to open ("reading 'emitsOptions'").
 * Every other test here stubs Teleport, which is how that hid.
 */
describe("ScanPage in its own layout", () => {
  it("puts the typed fallback in the layout's bottom bar", async () => {
    const { defineComponent, h } = await import("vue");
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const ShopLayout = (await import("@/layouts/ShopLayout.vue")).default;
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
    const Shell = defineComponent({ render: () => h(ShopLayout, null, { default: () => h(ScanPage) }) });
    const wrapper = mount(Shell, { attachTo: document.body, global: { plugins: [router] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector("#shop-action-bar input")).not.toBeNull();
    wrapper.unmount();
  });

  /**
   * DESIGN-SYSTEM-CONTRACT.md §9 rule 1 on the one page `AppShell` does not wrap. Until M9c's browser pass
   * (2026-10-29) nothing provided the touch floor here, and the Scan page — used with a scanner in the other
   * hand — drew Back, the typed code, Find and the camera at 36 px.
   */
  it.each([
    ["a touched tablet", true, "h-12"],
    ["a desk with a mouse", false, "h-9"],
  ])("draws its controls at the touch floor on %s, and not otherwise", async (_name, coarse, height) => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (media: string) => ({
        matches: media.includes("coarse") ? coarse : false,
        media, onchange: null, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      }),
    });
    const { defineComponent, h } = await import("vue");
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const ShopLayout = (await import("@/layouts/ShopLayout.vue")).default;
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
    const Shell = defineComponent({ render: () => h(ShopLayout, null, { default: () => h(ScanPage) }) });
    const wrapper = mount(Shell, { attachTo: document.body, global: { plugins: [router] } });
    await new Promise((r) => setTimeout(r, 0));
    const find = [...document.querySelectorAll("#shop-action-bar button")].find((b) => b.textContent?.trim() === "Find")!;
    expect(find.className.split(" ")).toContain(height);
    expect(document.querySelector('[data-test="scan-camera"]')!.className.split(" ")).toContain(height);
    wrapper.unmount();
  });
});

describe("ScanPage", () => {
  beforeEach(() => {
    submitted.code = null;
    submitted.seq = null;
    manage.value = true;
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

  /**
   * M9c: the camera, for when the handheld is not near. Its read must land where a trigger pull lands — the
   * same submit, the same lookup — and one code is one lookup, so it is opened to close after the first.
   */
  it("opens the camera from the bottom bar, and its read is looked up like a scanner's", async () => {
    const wrapper = render();
    expect(wrapper.findComponent({ name: "BarcodeCamera" }).exists()).toBe(false);
    await wrapper.find('[data-test="scan-camera"]').trigger("click");

    const camera = wrapper.findComponent({ name: "BarcodeCamera" });
    expect(camera.props("once")).toBe(true);
    expect(camera.props("reader").formats).toEqual(expect.arrayContaining(["QRCode", "Code128", "UPC-A"]));

    camera.vm.$emit("read", BIN_TAG);
    camera.vm.$emit("close");
    await wrapper.vm.$nextTick();
    expect(submitted.code?.value).toBe(BIN_TAG);
    expect(wrapper.text()).toContain("Oil filter");
    expect(wrapper.findComponent({ name: "BarcodeCamera" }).exists()).toBe(false);
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
   * M8 made shop parts FleetPal's, so a supplier barcode nobody knows is no longer an offer to create
   * a part here: the screen says where shop parts come from and offers nothing to save.
   */
  it("says a supplier barcode nobody knows is not recognised, and offers no part to create (M8)", async () => {
    const wrapper = render();
    scan(STRANGE_BARCODE);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Not recognised");
    expect(wrapper.text()).toContain("Shop parts come from FleetPal");
    expect(wrapper.findAll("button").some((b) => b.text().includes("Create a part") || b.text().includes("Add"))).toBe(false);
  });

  /**
   * M9b. The sticker on the back of a new tablet, scanned here: the IMEI is not on file, so the card
   * says so and "Add this tablet" opens Add equipment with the IMEI in it — read off the scan, never
   * retyped. While that drawer is open the page stops listening, as it does for every drawer.
   */
  it("offers to add a tablet whose IMEI is not on file, with the IMEI carried into the form", async () => {
    const wrapper = render();
    scan(NEW_IMEI);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("A tablet not on file yet");
    await wrapper.findAll("button").find((b) => b.text() === "Add this tablet")!.trigger("click");
    expect(wrapper.findComponent({ name: "AssetDrawer" }).props("initial")).toEqual({ imei: NEW_IMEI });

    scan(BIN_TAG);
    await wrapper.vm.$nextTick();
    expect(submitted.code?.value).toBe(NEW_IMEI);
  });

  it("refuses a misread IMEI with the form's sentence, and offers nothing to save", async () => {
    const wrapper = render();
    scan(BAD_IMEI);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("That is not an IMEI — scan the barcode marked IMEI.");
    expect(wrapper.findAll("button").some((b) => b.text().includes("Add"))).toBe(false);
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

  /**
   * R2 (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5). The query re-runs only when its key changes, and
   * the same label twice sets `code` to the value it already holds — so before the scan counter the
   * second look-up never happened and the screen kept the old quantity. Typed twice here because the
   * scanner path deliberately swallows the same code inside 800 ms (a held trigger), and typing is
   * deliberate every time.
   */
  it("asks again when the same code arrives twice", async () => {
    const wrapper = render();

    await wrapper.find("input").setValue(BIN_TAG);
    await wrapper.find("form").trigger("submit");
    const first = submitted.seq!.value;
    // Found again: under the stubbed Teleport, rendering the result re-creates the field.
    await wrapper.find("input").setValue(BIN_TAG);
    await wrapper.find("form").trigger("submit");

    expect(submitted.code?.value).toBe(BIN_TAG);
    expect(submitted.seq!.value).toBe(first + 1);
  });

  /** R11. A scanner set to end with Tab, firing into the focused field, used to submit nothing. */
  it("submits the typed field on Tab", async () => {
    const wrapper = render();
    await wrapper.find("input").setValue(BIN_TAG);

    await wrapper.find("input").trigger("keydown", { key: "Tab" });

    expect(submitted.code?.value).toBe(BIN_TAG);
    expect(wrapper.find("input").element.value).toBe("");
  });

  /**
   * R3. A tag garbled by the keyboard layout must never be offered as a new part's barcode — that
   * saves the garbage. The screen names the fix instead.
   */
  it("calls a garbled label a misread and offers no part to create", async () => {
    const wrapper = render();
    scan(MISREAD_TAG);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("The scanner misread that label");
    expect(wrapper.text()).toContain("US English");
    expect(wrapper.findAll("button").some((b) => b.text().includes("Create a part"))).toBe(false);
  });

  /** R12. The route is `maintenance: view`; a viewer sees what it is and is offered no writes. */
  it("shows a viewer the shelf without its verbs", async () => {
    manage.value = false;
    const wrapper = render();
    scan(BIN_TAG);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Oil filter");
    expect(wrapper.findAll("button").some((b) => b.text() === "Issue")).toBe(false);

    scan(STRANGE_BARCODE);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Not recognised");
    expect(wrapper.findAll("button").some((b) => b.text().includes("Create a part"))).toBe(false);
  });
});
