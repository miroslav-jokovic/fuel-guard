import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import type { LiveCapture, LiveScanState } from "@/features/apply/capture/useLiveScan";
import { TAKEN_HOLD_MS, type LiveRefusal, type LiveSlot } from "@/features/apply/capture/liveFrame";
import { pickPhotoFromCamera } from "@/features/apply/capture/webImageIo";

/**
 * The live scanner's SCREEN (2026-09-30, the owner-approved mock): what each state shows and what each press
 * does, with the scan loop itself replaced — `useLiveScan.test.ts` is where the loop is proven, and Chromium's
 * fake camera (`e2e-apply/scanner.spec.ts`) is where the two meet.
 */

const fake = {
  state: ref<LiveScanState>("starting"),
  refusal: ref<LiveRefusal | null>(null),
  torchOn: ref(false),
  torchAvailable: ref(false),
  start: vi.fn(async () => {}),
  shutter: vi.fn(),
  stop: vi.fn(),
  toggleTorch: vi.fn(async () => {}),
  onCapture: null as ((c: LiveCapture) => void) | null,
  slot: null as LiveSlot | null,
};

vi.mock("@/features/apply/capture/useLiveScan", () => ({
  useLiveScan: (_video: unknown, options: { onCapture: (c: LiveCapture) => void; slot: LiveSlot }) => {
    fake.onCapture = options.onCapture;
    fake.slot = options.slot;
    return fake;
  },
}));
const picked = { camera: null as File | null, file: null as File | null };
vi.mock("@/features/apply/capture/webImageIo", () => ({
  pickPhotoFromCamera: vi.fn(async () => picked.camera),
  pickImageFile: vi.fn(async () => picked.file),
}));

const { default: LiveScanner } = await import("./LiveScanner.vue");

let wrapper: VueWrapper | null = null;
const body = () => document.body;
const q = (sel: string) => body().querySelector(sel);
const button = (name: string): HTMLButtonElement | undefined =>
  [...body().querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);

async function open(props: { photo?: LiveSlot; tips?: boolean } = {}) {
  wrapper = mount(LiveScanner, { props: { photo: "cdl_front", ...props }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  fake.state.value = "starting";
  fake.refusal.value = null;
  fake.torchOn.value = false;
  fake.torchAvailable.value = false;
  fake.start.mockImplementation(async () => {
    fake.state.value = "aiming";
  });
  picked.camera = null;
  picked.file = null;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => "blob:taken");
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the tips", () => {
  it("come first when asked for, and the camera is not opened until the driver presses past them", async () => {
    const w = await open({ tips: true });
    expect(q("[data-live-tips]")).not.toBeNull();
    expect(q("video")).toBeNull();
    expect(fake.start).not.toHaveBeenCalled();

    button("Open the camera")!.click();
    await flushPromises();
    expect(w.emitted("tipsSeen")).toHaveLength(1);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(q("[data-live-tips]")).toBeNull();
    expect(q("[data-live-shutter]")).not.toBeNull();
  });

  it("are skipped when the visit has seen them, and the camera opens at once", async () => {
    await open({ tips: false });
    expect(q("[data-live-tips]")).toBeNull();
    expect(fake.start).toHaveBeenCalledTimes(1);
  });

  // "One press away in every state" includes this one: a driver can leave for the camera app from the tips.
  it("still offer the camera app, and a cancelled camera app does not open the live camera behind the tips", async () => {
    const w = await open({ tips: true });
    button("Camera app")!.click();
    await flushPromises();
    expect(fake.start).not.toHaveBeenCalled();
    expect(q("[data-live-tips]")).not.toBeNull();

    picked.camera = new File(["x"], "cdl.jpg", { type: "image/jpeg" });
    button("Camera app")!.click();
    await flushPromises();
    expect(w.emitted("captured")?.[0]).toEqual([{ file: picked.camera, captureMode: "web_file_input" }]);
  });
});

describe("the live view", () => {
  it("names the side above the frame and offers four corners, a round shutter and the two ways out", async () => {
    await open({ photo: "cdl_back" });
    expect(q("[data-live-side]")?.textContent).toContain("Back — the side with the barcode");
    expect(q("[data-live-outline]")?.querySelectorAll("span.aspect-square")).toHaveLength(4);
    expect(q("[data-live-shutter]")?.getAttribute("aria-label")).toBe("Take photo");
    expect(button("Camera app")).toBeDefined();
    expect(button("Upload a photo")).toBeDefined();
  });

  it("paints the corners by state: white aiming, the brand colour settling", async () => {
    await open();
    const corner = () => q("[data-live-outline] span.aspect-square")!.className;
    expect(corner()).toContain("border-ink-inverse");
    fake.state.value = "settling";
    await flushPromises();
    expect(corner()).toContain("border-brand-400");
    expect(q("[data-live-shutter]")?.hasAttribute("disabled")).toBe(true);
  });

  it("offers the flashlight only where the camera has one, and says which way it will switch", async () => {
    await open();
    expect(q("[data-live-torch]")).toBeNull();
    fake.torchAvailable.value = true;
    await flushPromises();
    expect(q("[data-live-torch]")?.getAttribute("aria-label")).toBe("Turn the flashlight on");
    (q("[data-live-torch]") as HTMLButtonElement).click();
    expect(fake.toggleTorch).toHaveBeenCalledTimes(1);
    fake.torchOn.value = true;
    await flushPromises();
    expect(q("[data-live-torch]")?.getAttribute("aria-label")).toBe("Turn the flashlight off");
    expect(q("[data-live-torch]")?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("once the photo is taken", () => {
  it("shows the kept frame with a check and green corners, buzzes, and hands it on only after the hold", async () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const w = await open();
    const file = new File(["frame"], "licence.jpg", { type: "image/jpeg" });

    fake.onCapture!({ file, licence: null });
    await flushPromises();
    expect(q("[data-live-taken]")).not.toBeNull();
    expect(q("[data-live-outline] img")?.getAttribute("src")).toBe("blob:taken");
    expect(q("[data-live-outline] span.aspect-square")!.className).toContain("border-success-400");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(w.emitted("captured")).toBeUndefined();

    vi.advanceTimersByTime(TAKEN_HOLD_MS - 1);
    expect(w.emitted("captured")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(w.emitted("captured")?.[0]).toEqual([{ file, captureMode: "web_live_camera" }]);
    Reflect.deleteProperty(navigator, "vibrate");
  });

  // iOS Safari has no `navigator.vibrate`; the moment must still happen without it.
  it("works the same on a phone that cannot buzz", async () => {
    vi.useFakeTimers();
    const w = await open();
    fake.onCapture!({ file: new File(["f"], "l.jpg"), licence: null });
    vi.advanceTimersByTime(TAKEN_HOLD_MS);
    expect(w.emitted("captured")).toHaveLength(1);
  });

  it("hands nothing on if the driver closes during the hold", async () => {
    vi.useFakeTimers();
    const w = await open();
    fake.onCapture!({ file: new File(["f"], "l.jpg"), licence: null });
    await flushPromises();
    button("Close the camera")!.click();
    vi.advanceTimersByTime(TAKEN_HOLD_MS * 2);
    expect(w.emitted("captured")).toBeUndefined();
    expect(w.emitted("cancel")).toHaveLength(1);
  });
});

describe("a refusal", () => {
  it("puts the reason in the camera's place and makes the camera app the main button", async () => {
    fake.start.mockImplementation(async () => {
      fake.state.value = "refused";
      fake.refusal.value = "denied";
    });
    const w = await open();
    expect(body().querySelector("[role=alert]")?.textContent).toContain("Camera access is off for this page");
    expect(q("[data-live-shutter]")).toBeNull();
    expect(button("Use the camera app instead")).toBeDefined();
    expect(button("Upload a photo instead")).toBeDefined();
    expect(w.emitted("unavailable")?.[0]).toEqual(["denied"]);
  });

  it("offers Try again only for a busy camera, which is not reported as unavailable", async () => {
    fake.start.mockImplementation(async () => {
      fake.state.value = "refused";
      fake.refusal.value = "busy";
    });
    const w = await open();
    expect(button("Try again")).toBeDefined();
    expect(w.emitted("unavailable")).toBeUndefined();
  });
});

/**
 * The medical card and the selfie (owner, 2026-09-30, Q-AW53): the same scanner, each framed as itself. What
 * differs is `liveFrame.LIVE_SLOTS`'s; these pin that the screen reads it, slot by slot.
 */
describe("the medical card", () => {
  it("is framed as a letter-size page with the four corners, named as the certificate, and taken by the shutter", async () => {
    await open({ photo: "medical_card" });
    expect(fake.slot).toBe("medical_card");
    const outline = q("[data-live-outline]")!;
    expect(outline.getAttribute("data-live-outline")).toBe("page");
    expect(outline.className).toContain("aspect-[8.5/11]");
    expect(outline.querySelectorAll("span.aspect-square")).toHaveLength(4);
    expect(q("[data-live-oval]")).toBeNull();
    expect(q("[data-live-side]")?.textContent).toContain("Your DOT medical examiner's certificate");
    expect(body().textContent).toContain("Fit the page inside the corners, then press the button.");
    expect(q("video")?.className).not.toContain("-scale-x-100");
    // No barcode, so no sweep: nothing on this page is being read.
    expect(q(".scan-sweep")).toBeNull();
  });

  it("opens on the document's tips under its own heading", async () => {
    await open({ photo: "medical_card", tips: true });
    expect(q("[data-live-tips]")?.getAttribute("data-live-tips")).toBe("document");
    expect(body().textContent).toContain("Photograph your medical card");
    expect(body().textContent).toContain("Turn it away from lamps and windows");
  });

  it("offers the flashlight, being the rear camera", async () => {
    await open({ photo: "medical_card" });
    fake.torchAvailable.value = true;
    await flushPromises();
    expect(q("[data-live-torch]")).not.toBeNull();
  });
});

describe("the selfie", () => {
  it("is framed by an oval, not card corners, and its preview is mirrored", async () => {
    await open({ photo: "selfie" });
    expect(fake.slot).toBe("selfie");
    const outline = q("[data-live-outline]")!;
    expect(outline.getAttribute("data-live-outline")).toBe("face");
    expect(outline.className).toContain("rounded-full");
    expect(q("[data-live-oval]")).not.toBeNull();
    expect(outline.querySelectorAll("span.aspect-square")).toHaveLength(0);
    expect(q("video")?.className).toContain("-scale-x-100");
    expect(q("[data-live-side]")?.textContent).toContain("Your face");
    expect(body().textContent).toContain("Fit your face in the oval, then press the button.");
  });

  it("opens on a face's tips, not a document's", async () => {
    await open({ photo: "selfie", tips: true });
    expect(q("[data-live-tips]")?.getAttribute("data-live-tips")).toBe("face");
    expect(body().textContent).toContain("Take a photo of yourself");
    expect(body().textContent).toContain("Take off sunglasses and a hat.");
    expect(body().textContent).toContain("Face a window or a light, not away from it.");
    expect(body().textContent).not.toContain("Lay the card flat");
  });

  it("never offers the flashlight, even where a camera says it has one", async () => {
    await open({ photo: "selfie" });
    fake.torchAvailable.value = true;
    await flushPromises();
    expect(q("[data-live-torch]")).toBeNull();
  });

  it("holds the frame it took as the preview showed it, mirrored, inside the oval", async () => {
    vi.useFakeTimers();
    await open({ photo: "selfie" });
    fake.onCapture!({ file: new File(["f"], "me.jpg"), licence: null });
    await flushPromises();
    const held = q("[data-live-outline] img")!;
    expect(held.className).toContain("-scale-x-100");
    expect(held.className).toContain("rounded-full");
    expect(q("[data-live-oval]")!.className).toContain("border-success-400");
  });

  it("sends the camera app to the FRONT camera, as the scanner was", async () => {
    await open({ photo: "selfie" });
    button("Camera app")!.click();
    await flushPromises();
    expect(pickPhotoFromCamera).toHaveBeenCalledWith("user");
  });

  it("while a document's camera app is the rear one", async () => {
    await open({ photo: "medical_card" });
    button("Camera app")!.click();
    await flushPromises();
    expect(pickPhotoFromCamera).toHaveBeenCalledWith("environment");
  });
});
