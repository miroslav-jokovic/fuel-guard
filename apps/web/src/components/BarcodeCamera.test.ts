import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { LiveCamera, OpenResult } from "@/lib/camera/liveCamera";
import BarcodeCamera from "./BarcodeCamera.vue";

/**
 * The camera's screen (M9c). The loop is `useBarcodeCamera.test.ts`'s; this pins what the person is shown and
 * what the screen hands back — a read, then (on the Scan page) the close — with the camera and the decoder
 * handed in through the props that exist for it.
 */

const camera = (): LiveCamera => ({
  size: () => ({ width: 1280, height: 720 }),
  sample: () => ({ width: 1, height: 1 }) as ImageData,
  snapshot: () => {
    throw new Error("never kept");
  },
  onEnded: () => {},
  torch: null,
  stop: vi.fn(),
});

let wrapper: VueWrapper | null = null;
const panel = () => document.body.querySelector("[data-barcode-camera]");

async function open(props: { once?: boolean; opened?: OpenResult; texts?: string[] } = {}) {
  const texts = props.texts ?? [];
  wrapper = mount(BarcodeCamera, {
    props: {
      title: "Scan the sticker",
      hint: "Hold the sticker inside the box.",
      reader: { formats: ["Code128"] },
      once: props.once,
      open: async () => props.opened ?? { ok: true, camera: camera() },
      load: async () => async () => texts.splice(0),
    },
    attachTo: document.body,
  });
  await flushPromises();
  // Two frames' worth of animation callbacks, so the loop runs a read.
  await new Promise((r) => setTimeout(r, 60));
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("the barcode camera's screen", () => {
  it("shows the hint until something reads, then counts what it read", async () => {
    const w = await open({ texts: ["SM-T575", "R52W40ABCDE"] });
    expect(w.emitted("read")?.map((e) => e[0])).toEqual(["SM-T575", "R52W40ABCDE"]);
    expect(panel()?.querySelector("[data-barcode-status]")?.textContent).toContain("2 barcodes read");
    expect(w.emitted("close")).toBeUndefined();
  });

  it("with `once`, hands back the first read and closes", async () => {
    const w = await open({ once: true, texts: ["SIL1:BIN:7K3M9P"] });
    expect(w.emitted("read")?.[0]).toEqual(["SIL1:BIN:7K3M9P"]);
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("says why the camera did not open, and points at the handheld", async () => {
    await open({ opened: { ok: false, refusal: "denied" } });
    expect(panel()?.querySelector("[data-barcode-refusal]")?.textContent).toContain("handheld scanner");
    expect(panel()?.querySelector("[data-barcode-aim]")).toBeNull();
  });

  it("closes on Done", async () => {
    const w = await open();
    const done = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Done")!;
    done.click();
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
  });
});
