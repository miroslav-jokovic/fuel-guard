import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { CaptureProvider, CapturedPage } from "@silvicom/capture-engine";
import { APPLICATION_CAPTURE_KEEP_DAYS, type ApplicationCaptureView } from "@silvicom/shared";
import PartOnePhoto from "./PartOnePhoto.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The scanner screen (§6.6.1, §6.6.6, C3b2b), as the driver meets it: an outline and two buttons; after
 * "Take photo" the picture and "Use this photo / Retake"; nothing sent before "Use this photo".
 *
 * The provider and the three network calls are replaced at their modules, so the component's own
 * `useApplicationCaptures` runs for real — what is pinned is the screen over the real state machine.
 */
const net = vi.hoisted(() => ({
  calls: [] as string[],
  confirm: null as null | (() => Promise<unknown>),
  source: [] as string[],
}));
vi.mock("@/features/apply/capture/webImageIo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/apply/capture/webImageIo")>()),
  pickPhotoFromCamera: async () => {
    net.source.push("camera");
    return new File(["camera"], "a.jpg", { type: "image/jpeg" });
  },
  pickImageFile: async () => {
    net.source.push("file");
    return new File(["file"], "b.jpg", { type: "image/jpeg" });
  },
}));
vi.mock("@/features/apply/capture/webFileProvider", () => ({
  createWebFileProvider: (_c: unknown, options: { pick: () => Promise<File | null> }): CaptureProvider => ({
    id: "t",
    version: "0",
    isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
    scan: async () => {
      await options.pick();
      const page = {
        originalOfRecord: { uri: "blob:held", width: 1568, height: 1000, bytes: 9, mediaType: "image/webp" },
        integrityHash: "ab".repeat(32),
      } as unknown as CapturedPage;
      return { ok: true, pages: [page] };
    },
    cancel: () => {},
  }),
}));
vi.mock("@/features/apply/useApplication", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/apply/useApplication")>()),
  startApplicationCapture: async () => {
    net.calls.push("start");
    return { captureId: "c", storagePath: "p", uploadUrl: "https://s.test/u", uploadToken: "t" };
  },
  uploadCaptureBytes: async () => {
    net.calls.push("upload");
  },
  confirmApplicationCapture: async () => {
    net.calls.push("confirm");
    if (net.confirm) return net.confirm();
    return { slot: "cdl_front", capturedAt: "2026-09-27T12:00:00Z" };
  },
}));

beforeEach(() => {
  net.calls = [];
  net.confirm = null;
  net.source = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/webp" }) })));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const copy = APPLY_COPY.partOne.photo;
const ANSWERS = { medical_card_pending: false } as never;

const mountPhoto = (
  props: { captures?: ApplicationCaptureView[]; photo?: "cdl_front" | "cdl_back" | "medical_card" | "selfie"; desktop?: boolean; answers?: object } = {},
) =>
  mount(PartOnePhoto, {
    props: {
      token: "t", carrier: "Silvicom Inc", photo: props.photo ?? "cdl_front", captures: props.captures ?? [],
      errors: {}, answers: (props.answers ?? ANSWERS) as never, desktop: props.desktop ?? false,
    },
    // The handoff has its own test (PartOneHandoff.test.ts); here only WHEN it shows is asserted.
    global: { stubs: { PartOneHandoff: { template: "<div data-test='handoff' />" } } },
  });

const button = (w: VueWrapper, label: string) => {
  const b = w.findAll("button").find((x) => x.text() === label);
  if (!b) throw new Error(`no button "${label}" in: ${w.findAll("button").map((x) => x.text()).join(" | ")}`);
  return b;
};
const labels = (w: VueWrapper) => w.findAll("button").map((b) => b.text());

describe("the scanner screen (§6.6.1)", () => {
  it("opens on the outline, the two-line hint, Take photo and Upload a photo instead", () => {
    const w = mountPhoto();
    expect(w.find("figcaption").text()).toBe(copy.cdl_front.outline);
    expect(w.text()).toContain(copy.cdl_front.hint);
    expect(w.text()).toContain(copy.howTo);
    expect(labels(w)).toEqual([copy.take, copy.upload]);
    expect(w.find("img").exists()).toBe(false);
  });

  it("every button on it is a 44 px tap target (§6.8)", async () => {
    const w = mountPhoto();
    for (const b of w.findAll("button")) expect(b.classes()).toContain("h-11");
    await button(w, copy.take).trigger("click");
    await flushPromises();
    expect(w.findAll("button")).toHaveLength(2);
    for (const b of w.findAll("button")) expect(b.classes()).toContain("h-11");
  });

  it("shows the photo large with Use this photo / Retake, and sends nothing until Use this photo", async () => {
    const w = mountPhoto();
    await button(w, copy.take).trigger("click");
    await flushPromises();
    expect(w.find("img").attributes("src")).toBe("blob:held");
    expect(labels(w)).toEqual([copy.use, copy.retake]);
    expect(w.text()).toContain(copy.check);
    expect(net.calls).toEqual([]);
    expect(w.emitted("holding")?.at(-1)).toEqual([true]);

    await button(w, copy.use).trigger("click");
    await flushPromises();
    expect(net.calls).toEqual(["start", "upload", "confirm"]);
    expect(w.text()).toContain(copy.received);
    expect(labels(w)).toEqual([copy.takeAgain, copy.upload]);
    expect(w.emitted("holding")?.at(-1)).toEqual([false]);
  });

  it("Upload a photo instead uses the file picker, and its retake reopens the file picker", async () => {
    const w = mountPhoto();
    await button(w, copy.upload).trigger("click");
    await flushPromises();
    expect(net.source).toEqual(["file"]);
    expect(labels(w)).toEqual([copy.use, copy.chooseAnother]);
    await button(w, copy.chooseAnother).trigger("click");
    await flushPromises();
    expect(net.source).toEqual(["file", "file"]);
  });

  it("says a photo did not arrive intact, and offers only a retake (D-AW9)", async () => {
    net.confirm = async () => {
      throw Object.assign(new Error("x"), { code: "capture_not_intact" });
    };
    const w = mountPhoto();
    await button(w, copy.take).trigger("click");
    await flushPromises();
    await button(w, copy.use).trigger("click");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe(copy.notIntact);
    expect(labels(w)).toEqual([copy.take, copy.upload]);
    expect(w.find("img").exists()).toBe(false);
  });

  it("after a lost signal keeps the photo and Use this photo, and says to press it again", async () => {
    let n = 0;
    net.confirm = async () => {
      if (n++ === 0) throw new Error("offline");
      return { slot: "cdl_front", capturedAt: "2026-09-27T12:00:00Z" };
    };
    const w = mountPhoto();
    await button(w, copy.take).trigger("click");
    await flushPromises();
    await button(w, copy.use).trigger("click");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe(copy.failed);
    expect(labels(w)).toEqual([copy.use, copy.retake]);
    await button(w, copy.use).trigger("click");
    await flushPromises();
    expect(w.text()).toContain(copy.received);
  });

  it("a photo taken on an earlier visit reads received, with no picture this browser never held", () => {
    const w = mountPhoto({ captures: [{ slot: "cdl_front", contentType: "image/webp", bytes: 1, capturedAt: "2026-09-20T00:00:00Z" }] });
    expect(w.text()).toContain(copy.receivedEarlier);
    expect(w.find("img").exists()).toBe(false);
    expect(labels(w)).toEqual([copy.takeAgain, copy.upload]);
  });

  it("hands the CDL back's original up for its barcode only after Use this photo", async () => {
    const w = mount(PartOnePhoto, {
      props: { token: "t", carrier: "Silvicom Inc", photo: "cdl_back", captures: [], errors: {}, answers: ANSWERS, readsBarcode: true },
    });
    await button(w, copy.take).trigger("click");
    await flushPromises();
    expect(w.emitted("staged")).toBeUndefined();
    await button(w, copy.use).trigger("click");
    await flushPromises();
    expect(w.emitted("staged")).toHaveLength(1);
  });
});

describe("on a computer (§6.6.6)", () => {
  const shown = (w: VueWrapper) => w.find("[data-test=handoff]").exists();

  it("offers the phone first while the slot is empty, and keeps both buttons beneath it", () => {
    const w = mountPhoto({ desktop: true });
    expect(shown(w)).toBe(true);
    expect(labels(w)).toEqual([copy.take, copy.upload]);
  });

  it("offers nothing extra on a phone", () => {
    expect(shown(mountPhoto())).toBe(false);
  });

  it("stops offering it once a photo is held here, or the slot is on file", async () => {
    const w = mountPhoto({ desktop: true });
    await button(w, copy.upload).trigger("click");
    await flushPromises();
    expect(shown(w)).toBe(false);
    const filed = mountPhoto({ desktop: true, captures: [{ slot: "cdl_front", contentType: "image/webp", bytes: 1, capturedAt: "2026-09-20T00:00:00Z" }] });
    expect(shown(filed)).toBe(false);
  });
});

/**
 * Screen 11, the selfie (AW6, §6.7): the same screen with the front camera, an oval, the why before the
 * button, and "I can't take one" — the medical card's "I don't have one yet" pattern.
 */
describe("the selfie screen", () => {
  it("says why and for how long before the camera opens, in the carrier's name", () => {
    const w = mountPhoto({ photo: "selfie", answers: { selfie_skipped: false } });
    const why = w.find("[data-selfie-why]");
    expect(why.text()).toBe(copy.selfie.why("Silvicom Inc", APPLICATION_CAPTURE_KEEP_DAYS));
    expect(why.text()).toContain("no face-recognition software");
    expect(why.text()).toContain(`deleted ${APPLICATION_CAPTURE_KEEP_DAYS} days`);
    expect(w.text()).toContain(copy.selfie.howTo);
    expect(w.text()).not.toContain(copy.howTo);
    expect(w.find("figure").classes()).toContain("rounded-full");
    expect(w.find("figcaption").text()).toBe(copy.selfie.outline);
  });

  it("offers I can't take one, and says what happens instead once it is ticked", async () => {
    const answers = { selfie_skipped: false };
    const w = mountPhoto({ photo: "selfie", answers });
    expect(w.text()).toContain(copy.selfie.cannot);
    expect(w.text()).not.toContain(copy.selfie.cannotHint);
    await w.setProps({ answers: { selfie_skipped: true } as never });
    expect(w.text()).toContain(copy.selfie.cannotHint);
  });

  it("does not offer it once a selfie is on file, and never on a document's screen", () => {
    const filed = mountPhoto({
      photo: "selfie", answers: { selfie_skipped: false },
      captures: [{ slot: "selfie", contentType: "image/webp", bytes: 1, capturedAt: "2026-09-27T14:00:00Z" }],
    });
    expect(filed.text()).not.toContain(copy.selfie.cannot);
    expect(filed.text()).toContain(copy.selfie.receivedEarlier);
    expect(mountPhoto().text()).not.toContain(copy.selfie.cannot);
    expect(mountPhoto().find("[data-selfie-why]").exists()).toBe(false);
  });

  it("asks a face, not a card, to be checked before it is sent", async () => {
    const w = mountPhoto({ photo: "selfie", answers: { selfie_skipped: false } });
    await button(w, copy.take).trigger("click");
    await flushPromises();
    expect(w.text()).toContain(copy.selfie.check);
    expect(w.text()).not.toContain(copy.check);
    expect(w.find("figure").classes()).toContain("rounded-surface");
  });
});
