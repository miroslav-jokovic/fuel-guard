import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import { APPLY_COPY } from "@/features/apply/strings";

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
