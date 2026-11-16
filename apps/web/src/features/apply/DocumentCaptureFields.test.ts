import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import type { ApplicationCaptureSlot, ApplicationCaptureView } from "@silvicom/shared";

/**
 * The one-press capture list (A8) on the screens with no preview step. Pinned here: the two ways a
 * send can fail read differently, because the driver's next move differs — a lost signal is retried,
 * a photo the server re-hashed and found not intact (D-AW9, 422 `capture_not_intact`) is retaken.
 */
const confirm = vi.hoisted(() => ({ fail: null as null | Error }));
vi.mock("@/features/apply/capture/webFileProvider", () => ({
  createWebFileProvider: () => ({
    id: "t", version: "0", cancel: () => {},
    takeBytes: () => new Blob(["x"], { type: "image/webp" }),
    isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
    scan: async () => ({
      ok: true,
      pages: [{ originalOfRecord: { uri: "blob:x", width: 1, height: 1, bytes: 1, mediaType: "image/webp" }, integrityHash: "ab".repeat(32) }],
    }),
  }),
}));
vi.mock("@/features/apply/useApplication", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/apply/useApplication")>()),
  startApplicationCapture: async () => ({ captureId: "c", storagePath: "p", uploadUrl: "https://s.test/u", uploadToken: "t" }),
  uploadCaptureBytes: async () => {},
  confirmApplicationCapture: async () => {
    throw confirm.fail;
  },
}));

beforeEach(() => {
  // ⚠ `fetch` refuses, as production's CSP does for a `blob:` URL (no `blob:` in `connect-src`, 2026-09-30): a
  // photograph must reach the upload as the bytes its provider handed over (`takeBytes`), never read back.
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

const takeOne = async (): Promise<string> => {
  const w = mount(DocumentCaptureFields, { props: { token: "t", captures: [], only: ["cdl_front"] } });
  await w.find("button").trigger("click");
  await flushPromises();
  return w.text();
};

describe("a photo that did not go through", () => {
  it("says to take it again when the server found it not intact", async () => {
    confirm.fail = Object.assign(new Error("x"), { code: "capture_not_intact" });
    const text = await takeOne();
    expect(text).toContain(APPLY_COPY.documents.notIntact);
    expect(text).not.toContain(APPLY_COPY.documents.failed);
  });

  it("says to check the signal when the network failed", async () => {
    confirm.fail = new Error("offline");
    const text = await takeOne();
    expect(text).toContain(APPLY_COPY.documents.failed);
    expect(text).not.toContain(APPLY_COPY.documents.notIntact);
  });
});

/**
 * Q-AM25 (a), owner 2026-11-15: on a phone whose browser has a camera API, "Take photo" in "Your documents"
 * opens the in-page scanner for that paper. Without one (jsdom here, an old browser) and on a computer, the
 * camera app takes the photo as before.
 */
describe("Take photo opens the in-page scanner", () => {
  const SCANNER = { name: "LiveScanner", props: ["photo", "tips"], emits: ["captured", "cancel", "unavailable", "tipsSeen"], template: "<div data-stub-scanner />" };
  const mountList = () => mount(DocumentCaptureFields, { props: { token: "t", captures: [] }, global: { stubs: { LiveScanner: SCANNER } } });
  const take = (w: ReturnType<typeof mountList>, slot: string) =>
    w.find(`[data-document-slot="${slot}"]`).findAll("button").find((b) => b.text() === APPLY_COPY.documents.take)!.trigger("click");
  const withCamera = (): void => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: vi.fn() } });
  };
  afterEach(() => vi.unstubAllGlobals());

  it("for the paper pressed, on a phone with a camera API, and closes when the driver closes it", async () => {
    withCamera();
    const w = mountList();
    await take(w, "passport");
    const scanner = w.findComponent(SCANNER);
    expect(scanner.exists()).toBe(true);
    expect(scanner.props("photo")).toBe("passport");
    scanner.vm.$emit("cancel");
    await flushPromises();
    expect(w.findComponent(SCANNER).exists()).toBe(false);
    expect(w.find('[data-document-slot="passport"]').text()).toContain(APPLY_COPY.documents.take);
  });

  it("stops offering it once the scanner says it cannot run on this phone", async () => {
    withCamera();
    const w = mountList();
    await take(w, "passport");
    w.findComponent(SCANNER).vm.$emit("unavailable", "unsupported");
    w.findComponent(SCANNER).vm.$emit("cancel");
    await flushPromises();
    await take(w, "twic");
    await flushPromises();
    expect(w.findComponent(SCANNER).exists()).toBe(false);
  });

  it("is not opened where the browser has no camera API, or on a computer", async () => {
    const plain = mountList();
    await take(plain, "passport");
    await flushPromises();
    expect(plain.findComponent(SCANNER).exists()).toBe(false);

    withCamera();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const computer = mountList();
    await take(computer, "passport");
    await flushPromises();
    expect(computer.findComponent(SCANNER).exists()).toBe(false);
  });
});

/** §9 P9: Part 2's "Your documents" — the licence shown and never re-asked, every other paper offered. */
describe("your documents (§9 P9)", () => {
  const cap = (slot: ApplicationCaptureSlot): ApplicationCaptureView => ({ slot, ordinal: 0, contentType: "image/webp", bytes: 1, capturedAt: "2026-10-30T00:00:00Z" });

  it("asks for what the driver has, shows the licence as received, and offers no button for it", () => {
    const w = mount(DocumentCaptureFields, { props: { token: "t", captures: [cap("cdl_front"), cap("cdl_back")] } });
    expect(w.text()).toContain("Send what you have now — you can bring the rest to the office.");
    expect(w.text()).not.toContain("skip them");
    const front = w.find('[data-document-slot="cdl_front"]');
    expect(front.text()).toContain(APPLY_COPY.documents.fromLicenceStep);
    expect(front.findAll("button")).toHaveLength(0);
    // Every other paper: a photo or a file.
    const passport = w.find('[data-document-slot="passport"]');
    expect(passport.text()).toContain(APPLY_COPY.documents.take);
    expect(passport.text()).toContain(APPLY_COPY.documents.upload);
  });

  it("numbers several training certificates and offers another", () => {
    const w = mount(DocumentCaptureFields, {
      props: { token: "t", captures: [cap("cdl_front"), { ...cap("training_certificate"), ordinal: 1 }, cap("training_certificate")] },
    });
    const tc = w.find('[data-document-slot="training_certificate"]');
    expect(tc.text()).toContain("Training certificate 1");
    expect(tc.text()).toContain("Training certificate 2");
    expect(tc.text()).toContain(APPLY_COPY.documents.addAnother);
  });
});
