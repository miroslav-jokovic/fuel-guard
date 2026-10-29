import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { AssetTypeDto } from "@silvicom/shared";
/** The TAC lookup's answer — the API is not under test here; `tacMatch.test.ts` pins the rule. */
const same = vi.hoisted(() => ({ answer: null as null | { manufacturer: string; model: string; fromDisplayNo: string } }));
vi.mock("./tacMatch", () => ({ findSameModel: async () => same.answer }));
import AssetForm from "./AssetForm.vue";

/**
 * M9b: the Add equipment form, filled from the sticker on the back of a tablet by the handheld.
 *
 * ── WHAT ONLY THIS FILE CAN SEE ───────────────────────────────────────────────────────────────
 *   1. **The scanner's Enter must not save.** It ends every read; a form that submitted on it would
 *      save a half-filled tablet on the first trigger pull.
 *   2. **A scan with nothing focused still lands** — the document listener, while the drawer is open.
 *   3. **A misread IMEI is refused by the form, with the sentence**, before the API's CHECK.
 */
const IMEI = "490154203237518";
const TYPES: AssetTypeDto[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Tablet", category: null, serialized: true, defaultKitQuantity: 1, imagePath: null, heldBy: "driver" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Load bar", category: null, serialized: false, defaultKitQuantity: 2, imagePath: null, heldBy: "unit" },
];

const mountForm = (props: Record<string, unknown> = {}) =>
  mount(AssetForm, { props: { types: TYPES, locations: [], active: true, ...props }, attachTo: document.body });

/** What a HID scanner does into a focused field: the characters, then Enter. */
async function scanInto(input: ReturnType<ReturnType<typeof mountForm>["find"]>, code: string) {
  await input.setValue(code);
  await input.trigger("keydown", { key: "Enter" });
}
/** What it does with nothing focused: a burst at machine speed on the document, then Enter. */
function scanIntoNothing(code: string) {
  (document.activeElement as HTMLElement | null)?.blur?.();
  for (const key of code) document.dispatchEvent(new KeyboardEvent("keydown", { key }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}
const value = (w: ReturnType<typeof mountForm>, label: string) =>
  (w.findAll("label").find((l) => l.text().startsWith(label))?.element.closest("div")?.querySelector("input") as HTMLInputElement | null)?.value;

beforeEach(() => setActivePinia(createPinia()));

describe("Add equipment, filled from the sticker", () => {
  it("fills IMEI, serial, model, maker, type and name from three scans, and saves nothing on the scanner's Enter", async () => {
    const w = mountForm();
    const sticker = w.find('[data-test="sticker-scan"]');
    for (const code of [IMEI, "R52W40ABCDE", "SM-T575"]) await scanInto(sticker, code);
    await flushPromises();

    expect((w.find('[data-test="imei"]').element as HTMLInputElement).value).toBe(IMEI);
    expect(value(w, "Serial number")).toBe("R52W40ABCDE");
    expect(value(w, "Model")).toBe("SM-T575");
    expect(value(w, "Manufacturer")).toBe("Samsung");
    expect(value(w, "Name")).toBe("Samsung SM-T575");
    expect(w.find('[data-test="sticker-log"]').text()).toContain(`IMEI ${IMEI}`);
    expect(w.emitted("submit")).toBeUndefined();

    await w.find("form").trigger("submit");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({ assetTypeId: TYPES[0]!.id, imei: IMEI, serialNumber: "R52W40ABCDE", model: "SM-T575" });
    w.unmount();
  });

  it("does not save when Enter lands in an ordinary field either", async () => {
    const w = mountForm();
    const imei = w.find('[data-test="sticker-scan"]');
    await scanInto(imei, IMEI);
    const field = w.find('[data-test="imei"]');
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    field.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    w.unmount();
  });

  it("takes a scan that arrives with nothing focused, while the drawer is open — and not when it is closed", async () => {
    const open = mountForm();
    scanIntoNothing(IMEI);
    await flushPromises();
    expect((open.find('[data-test="imei"]').element as HTMLInputElement).value).toBe(IMEI);
    open.unmount();

    const closed = mountForm({ active: false });
    scanIntoNothing("356938035643809");
    await flushPromises();
    expect(closed.find('[data-test="imei"]').exists()).toBe(false);
    closed.unmount();
  });

  it("refuses a misread IMEI typed into the field, with the sentence, and sends nothing", async () => {
    const w = mountForm({ initial: { assetTypeId: TYPES[0]!.id, name: "Cab tablet" } });
    await w.find('[data-test="imei"]').setValue("490154203237519");
    await w.find("form").trigger("submit");
    expect(w.emitted("submit")).toBeUndefined();
    expect(w.text()).toContain("That is not an IMEI — scan the barcode marked IMEI.");
    w.unmount();
  });

  it("offers the tablet type and a name for an IMEI carried in from the Scan page", async () => {
    const w = mountForm({ initial: { imei: IMEI } });
    await flushPromises();
    expect(value(w, "Name")).toBe("Tablet");
    await w.find("form").trigger("submit");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({ assetTypeId: TYPES[0]!.id, imei: IMEI });
    w.unmount();
  });

  it("shows no IMEI field for a load bar, and one for a tablet", async () => {
    expect(mountForm({ initial: { assetTypeId: TYPES[1]!.id } }).find('[data-test="imei"]').exists()).toBe(false);
    expect(mountForm({ initial: { assetTypeId: TYPES[0]!.id } }).find('[data-test="imei"]').exists()).toBe(true);
  });

  /**
   * M9c: the camera's reads go through the same `take` a handheld's do — same field, same list — and the list
   * is drawn under the camera's picture, so the person sees each barcode land without closing it.
   */
  it("fills the form from the camera exactly as from the handheld, and shows each read under the picture", async () => {
    const w = mount(AssetForm, {
      props: { types: TYPES, locations: [], active: true },
      attachTo: document.body,
      global: { stubs: { BarcodeCamera: { name: "BarcodeCamera", props: { reader: Object, title: String, hint: String, once: Boolean }, template: "<div data-test=\"camera\"><slot /></div>" } } },
    });
    await flushPromises();
    expect(w.find('[data-test="camera"]').exists()).toBe(false);
    await w.find('[data-test="sticker-camera"]').trigger("click");

    const camera = w.findComponent({ name: "BarcodeCamera" });
    expect(camera.props("once")).toBe(false);
    expect(camera.props("reader").formats).toContain("Code128");
    for (const code of ["SM-T575", IMEI, "R52W40ABCDE"]) camera.vm.$emit("read", code);
    await flushPromises();

    expect((w.find('[data-test="imei"]').element as HTMLInputElement).value).toBe(IMEI);
    expect(value(w, "Serial number")).toBe("R52W40ABCDE");
    expect(value(w, "Model")).toBe("SM-T575");
    expect(w.find('[data-test="sticker-camera-log"]').text()).toContain(`IMEI ${IMEI}`);
    expect(w.emitted("submit")).toBeUndefined();

    camera.vm.$emit("close");
    await flushPromises();
    expect(w.find('[data-test="camera"]').exists()).toBe(false);
    w.unmount();
  });
});

describe("the maker from the IMEI (owner 2026-10-29)", () => {
  beforeEach(() => { same.answer = null; });

  it("fills maker, model and name from a tablet on file with the same TAC, and says where from", async () => {
    same.answer = { manufacturer: "Samsung", model: "SM-T575", fromDisplayNo: "A-0412" };
    const w = mountForm();
    await scanInto(w.find('[data-test="sticker-scan"]'), IMEI);
    await flushPromises();
    expect(value(w, "Manufacturer")).toBe("Samsung");
    expect(value(w, "Model")).toBe("SM-T575");
    expect(value(w, "Name")).toBe("Samsung SM-T575");
    expect(w.find('[data-test="tac-note"]').text()).toContain("A-0412");
    w.unmount();
  });

  it("never overwrites a maker already typed", async () => {
    same.answer = { manufacturer: "Samsung", model: "SM-T575", fromDisplayNo: "A-0412" };
    const w = mountForm({ initial: { manufacturer: "Lenovo" } });
    await scanInto(w.find('[data-test="sticker-scan"]'), IMEI);
    await flushPromises();
    expect(value(w, "Manufacturer")).toBe("Lenovo");
    w.unmount();
  });

  it("leaves the fields empty when no tablet on file shares the TAC", async () => {
    const w = mountForm();
    await scanInto(w.find('[data-test="sticker-scan"]'), IMEI);
    await flushPromises();
    expect(value(w, "Manufacturer")).toBe("");
    expect(w.find('[data-test="tac-note"]').exists()).toBe(false);
    w.unmount();
  });

  it("offers the way to the types from the Type field, without submitting the form", async () => {
    const w = mountForm();
    await w.find('[data-test="manage-types"]').trigger("click");
    expect(w.emitted("manage-types")).toHaveLength(1);
    expect(w.emitted("submit")).toBeUndefined();
    w.unmount();
  });
});
