import { describe, it, expect, vi, beforeEach } from "vitest";

/** A swipe picture goes up as a brand-kit photo does: upload URL, the bytes, then the save the API checks. */
const calls = vi.hoisted(() => ({ api: [] as Array<{ path: string; body: unknown }>, refuseSave: false }));
vi.mock("@/lib/api", () => ({
  apiFetch: async (path: string, init?: { body?: unknown }) => {
    calls.api.push({ path, body: init?.body });
    if (path.endsWith("/upload-url")) return { ok: true, data: { upload_id: "u1", signed_url: "https://storage/put" } };
    if (calls.refuseSave) return { ok: false, error: { message: "The swipe file takes a PNG, JPEG or WebP picture." } };
    return { ok: true, data: { id: "e1" } };
  },
}));
import { anyWaiting, saveSwipePicture } from "./useAdsSwipe";

beforeEach(() => {
  calls.api = [];
  calls.refuseSave = false;
});

describe("saveSwipePicture", () => {
  it("asks for a URL, puts the bytes there, then saves the upload with its note", async () => {
    const put = vi.fn(async () => {});
    const file = new File(["x"], "ad.png", { type: "image/png" });
    await saveSwipePicture(file, "Seen on Facebook", put);
    expect(put).toHaveBeenCalledWith("https://storage/put", file);
    expect(calls.api).toEqual([
      { path: "/api/ads/swipe/pictures/upload-url", body: {} },
      { path: "/api/ads/swipe/pictures", body: { upload_id: "u1", note: "Seen on Facebook" } },
    ]);
  });

  it("refuses with the API's own sentence", async () => {
    calls.refuseSave = true;
    await expect(saveSwipePicture(new File(["x"], "ad.png"), null, async () => {})).rejects.toThrow("The swipe file takes a PNG, JPEG or WebP picture.");
  });
});

describe("anyWaiting", () => {
  it("the list is read again only while an entry is being read", () => {
    expect(anyWaiting(undefined)).toBe(false);
    expect(anyWaiting([{ state: "read" }, { state: "unreadable" }] as never)).toBe(false);
    expect(anyWaiting([{ state: "read" }, { state: "waiting" }] as never)).toBe(true);
  });
});
