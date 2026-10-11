import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { effectScope, ref } from "vue";
import type { CapturedPage } from "@silvicom/capture-engine";
import type { ApplicationCaptureView } from "@silvicom/shared";
import { PHOTO_COPY_TTL_MS, keepPhoto, readKeptPhoto, serverIsNewer, type KeptPhoto } from "./photoLocal";
import { readCopy } from "../deviceCopies";
import type { CaptureIo } from "./stageCapture";
import type { WebCaptureProvider } from "./webFileProvider";
import { useApplicationCaptures } from "./useApplicationCaptures";

/**
 * A photograph sent is never taken twice (AW10, C3d2, Q-AW38 (a)). Pinned: "Use this" puts the photograph
 * on the phone BEFORE the first byte goes, and only `confirm`'s answer (or a `capture_not_intact`
 * refusal) deletes it; a photograph still in review is never kept; the next visit puts a kept photograph
 * back in its slot and sends it — the same bytes and the same hash — unless the server's is newer; and a
 * phone coming back online resends a send that failed on the signal, by itself.
 */

vi.mock("./webFileProvider", () => ({ createWebFileProvider: () => ({}) }));

const TOKEN = "token-1";
const SPEC = { key: "k".repeat(64), linkExpiresAt: "2099-01-01T00:00:00Z" };
const HASH = "a1".repeat(32);
const BYTES = "the encoded licence";
/**
 * When the "next visit" tests kept their photograph: a minute ago, measured from the moment the file loads.
 *
 * It was the fixed instant 2026-09-28T10:00Z, while `readKeptPhoto` judges expiry against the REAL clock —
 * so the copy expired 72 h later (`PHOTO_COPY_TTL_MS`), at 10:00 UTC on 2026-10-01, and from then on two
 * of these tests failed on every branch and a third ("does not send it over a newer photograph") kept
 * passing for the wrong reason: an expired copy is never sent either. A kept time inside the TTL is the
 * precondition all three are about, so it must move with the clock.
 */
const KEPT_AT = new Date(Date.now() - 60_000);

const page = (): CapturedPage =>
  ({ originalOfRecord: { uri: "blob:taken", width: 1568, height: 990, bytes: 19, mediaType: "image/webp" }, integrityHash: HASH }) as unknown as CapturedPage;
const provider: WebCaptureProvider = {
  id: "t", version: "0", cancel: () => {},
  takeBytes: () => new Blob([BYTES], { type: "image/webp" }),
  isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
  scan: async () => ({ ok: true, pages: [page()] }),
};

function io(behave: { upload?: () => Promise<void>; confirm?: () => Promise<{ slot: "cdl_front"; capturedAt: string }> } = {}) {
  const sent: { hash: string; body: string }[] = [];
  const x: CaptureIo = {
    start: async () => ({ captureId: "c", storagePath: "p", uploadUrl: "u", uploadToken: "t" }),
    upload: async (_url: string, blob: Blob) => {
      sent.push({ hash: "", body: await blob.text() });
      if (behave.upload) await behave.upload();
    },
    confirm: async (_t, _id, body) => {
      sent[sent.length - 1]!.hash = body.sha256;
      return behave.confirm ? behave.confirm() : { slot: "cdl_front", capturedAt: "2026-09-28T12:00:00Z" };
    },
    digest: async () => "unused",
  };
  return { io: x, sent };
}

function mountCaptures(capIo: CaptureIo, already: ApplicationCaptureView[] = [], spec: typeof SPEC | null = SPEC) {
  const scope = effectScope();
  const onStaged = vi.fn();
  const api = scope.run(() =>
    useApplicationCaptures(ref(TOKEN), ref(already), { provider, io: capIo, only: ["cdl_front"], onStaged, local: ref(spec) }),
  )!;
  const state = () => api.slots.value[0]!.state;
  return { ...api, state, onStaged, stop: () => scope.stop() };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // ⚠ `fetch` refuses, as production's CSP does for a `blob:` URL (no `blob:` in `connect-src`, 2026-09-30):
  // the bytes kept and sent are the ones the provider handed over (`takeBytes`), never read back.
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // jsdom has no createObjectURL at all; the put-back path makes one for the preview.
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => "blob:put-back");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("keeping the photograph", () => {
  it("is on the phone before the upload starts, with its hash, and gone once confirm answers", async () => {
    let keptDuringUpload: KeptPhoto | null = null;
    const { io: x } = io({ upload: async () => { keptDuringUpload = await readKeptPhoto(SPEC, "cdl_front"); } });
    const c = mountCaptures(x);
    await c.take("cdl_front");
    await c.use("cdl_front");
    expect(keptDuringUpload).toMatchObject({ slot: "cdl_front", contentType: "image/webp", integrityHash: HASH });
    expect(new TextDecoder().decode(keptDuringUpload!.bytes)).toBe(BYTES);
    expect(c.state()).toBe("done");
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    c.stop();
  });

  it("stays on the phone when the upload is cut", async () => {
    const { io: x } = io({ upload: offline });
    const c = mountCaptures(x);
    await c.take("cdl_front");
    await c.use("cdl_front");
    expect(c.state()).toBe("failed");
    expect(await readKeptPhoto(SPEC, "cdl_front")).not.toBeNull();
    c.stop();
  });

  it("is let go when the server refuses the bytes as not intact — sending them again changes nothing", async () => {
    const { io: x } = io({ confirm: () => Promise.reject(Object.assign(new Error("x"), { code: "capture_not_intact" })) });
    const c = mountCaptures(x);
    await c.take("cdl_front");
    await c.use("cdl_front");
    expect(c.slots.value[0]!.failure).toBe("not_intact");
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    c.stop();
  });

  it("is never kept while it is only in review — nothing leaves the screen before Use this", async () => {
    const c = mountCaptures(io().io);
    await c.take("cdl_front");
    expect(c.state()).toBe("review");
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    c.stop();
  });

  it("keeps each slot apart — the medical card never replaces the licence", async () => {
    await keepPhoto(SPEC, "cdl_front", new Blob(["front"]), "image/webp", HASH);
    await keepPhoto(SPEC, "medical_card", new Blob(["card"]), "image/webp", HASH);
    expect(new TextDecoder().decode((await readKeptPhoto(SPEC, "cdl_front"))!.bytes)).toBe("front");
    expect(new TextDecoder().decode((await readKeptPhoto(SPEC, "medical_card"))!.bytes)).toBe("card");
  });

  /**
   * A phone that ran C3d1b holds this database at version 1, with no `photos` store. Without the upgrade
   * every photograph put would throw, the store would resolve as designed, and nothing would ever be kept.
   */
  it("upgrades a database C3d1b left at version 1, keeping its copies and gaining the photos store", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("silvicom-apply", 1);
      req.onupgradeneeded = () => {
        for (const s of ["partOne", "partTwo"]) req.result.createObjectStore(s, { keyPath: "key" });
      };
      req.onsuccess = () => {
        const tx = req.result.transaction("partTwo", "readwrite");
        tx.objectStore("partTwo").put({ key: "draft", version: 1, expiresAt: "2099-01-01T00:00:00Z" });
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });
    await keepPhoto(SPEC, "cdl_front", new Blob([BYTES]), "image/webp", HASH);
    expect(await readKeptPhoto(SPEC, "cdl_front")).not.toBeNull();
    expect(await readCopy("partTwo", "draft", () => true)).not.toBeNull();
  });

  it("keeps nothing for a page with no copy spec", async () => {
    const c = mountCaptures(io({ upload: offline }).io, [], null);
    await c.take("cdl_front");
    await c.use("cdl_front");
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    c.stop();
  });
});

describe("the next visit", () => {
  it("puts the kept photograph back and sends the same bytes with the same hash — no retake", async () => {
    const first = mountCaptures(io({ upload: offline }).io);
    await first.take("cdl_front");
    await first.use("cdl_front");
    first.stop();

    const { io: x, sent } = io();
    const second = mountCaptures(x);
    await second.replayed;
    expect(sent).toEqual([{ hash: HASH, body: BYTES }]);
    expect(second.state()).toBe("done");
    expect(second.slots.value[0]!.previewUrl).toBe("blob:put-back");
    expect(second.onStaged).toHaveBeenCalledWith("cdl_front", expect.any(Blob));
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    second.stop();
  });

  it("keeps it held, with Use this working, when the resend fails too — and does not re-keep it", async () => {
    await keepPhoto(SPEC, "cdl_front", new Blob([BYTES]), "image/webp", HASH, KEPT_AT);
    const c = mountCaptures(io({ upload: offline }).io);
    await c.replayed;
    expect(c.state()).toBe("failed");
    expect(c.slots.value[0]!.pending).toBe(true);
    // The same copy, not a new one: each failed visit must not push its keptAt, and its expiry, forward.
    expect((await readKeptPhoto(SPEC, "cdl_front"))?.keptAt).toBe(KEPT_AT.toISOString());
    c.stop();
  });

  it("gives way to a photograph taken on this screen while the phone was being read", async () => {
    await keepPhoto(SPEC, "cdl_front", new Blob([BYTES]), "image/webp", HASH);
    const { io: x, sent } = io();
    const c = mountCaptures(x);
    await c.take("cdl_front");
    await c.replayed;
    expect(c.state()).toBe("review");
    expect(sent).toEqual([]);
    c.stop();
  });

  it("does not send it over a newer photograph on the server, and lets it go", async () => {
    await keepPhoto(SPEC, "cdl_front", new Blob([BYTES]), "image/webp", HASH, KEPT_AT);
    const { io: x, sent } = io();
    const c = mountCaptures(x, [{ slot: "cdl_front", capturedAt: new Date(KEPT_AT.getTime() + 5_000).toISOString() } as ApplicationCaptureView]);
    await c.replayed;
    expect(sent).toEqual([]);
    expect(c.state()).toBe("done");
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    c.stop();
  });

  it("sends it over an OLDER photograph on the server — a retake that never arrived", async () => {
    await keepPhoto(SPEC, "cdl_front", new Blob([BYTES]), "image/webp", HASH, KEPT_AT);
    const { io: x, sent } = io();
    const c = mountCaptures(x, [{ slot: "cdl_front", capturedAt: new Date(KEPT_AT.getTime() - 8 * 86_400_000).toISOString() } as ApplicationCaptureView]);
    await c.replayed;
    expect(sent).toHaveLength(1);
    c.stop();
  });
});

describe("coming back online", () => {
  it("resends a send that failed on the signal, by itself", async () => {
    let signal = false;
    const { io: x, sent } = io({ upload: () => (signal ? Promise.resolve() : offline()) });
    const c = mountCaptures(x);
    await c.take("cdl_front");
    await c.use("cdl_front");
    expect(c.state()).toBe("failed");
    signal = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(c.state()).toBe("done"));
    expect(sent).toHaveLength(2);
    expect(await readKeptPhoto(SPEC, "cdl_front")).toBeNull();
    c.stop();
  });

  it("never sends a photograph still in review — only one the driver pressed Use this on", async () => {
    const { io: x, sent } = io();
    const c = mountCaptures(x);
    await c.take("cdl_front");
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual([]);
    expect(c.state()).toBe("review");
    c.stop();
  });

  it("stops listening once the screen is gone", async () => {
    const { io: x, sent } = io({ upload: offline });
    const c = mountCaptures(x);
    await c.take("cdl_front");
    await c.use("cdl_front");
    c.stop();
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });
});

describe("the rules", () => {
  const kept = { keptAt: "2026-09-28T10:00:00.000Z" } as KeptPhoto;
  it("calls the server newer only when its photograph is at or after the kept one", () => {
    expect(serverIsNewer(kept, null)).toBe(false);
    expect(serverIsNewer(kept, "2026-09-28T09:59:59Z")).toBe(false);
    expect(serverIsNewer(kept, "2026-09-28T10:00:00Z")).toBe(true);
  });

  it("dies with the link when the link lapses before the 72 hours do", async () => {
    const soon = { ...SPEC, linkExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    await keepPhoto(soon, "cdl_front", new Blob([BYTES]), "image/webp", HASH);
    expect(await readKeptPhoto(soon, "cdl_front")).not.toBeNull();
    expect(await readKeptPhoto(soon, "cdl_front", new Date(Date.now() + 7_200_000))).toBeNull();
    expect(PHOTO_COPY_TTL_MS).toBe(72 * 3_600_000);
  });
});
