import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * This browser's device key (INSTALLED-APP-PLAN IA-S6, migration 0620): made once, kept, sent on every API call.
 * The database binds a session to the device named by its FIRST request, so a call without the key is not a
 * harmless omission — it records the browser as a second device. `apiFetch`, `fetchObjectUrl` and `apiDownload`
 * are held to sending it here; the call sites that build their own headers spread the same `deviceHeader()`.
 */
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth } }));
vi.mock("./stepUp", () => ({ stepUpHeader: () => ({}), clearStepUp: vi.fn() }));

const store = new Map<string, string>();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "bearer-1" } } });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => ({}), blob: async () => new Blob(["x"]) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const sent = (i = 0) => (fetchMock.mock.calls[i]![1] as { headers: Record<string, string> }).headers["x-silvicom-device"];

describe("deviceKey", () => {
  it("is made once in the app's alphabet and kept: the same browser is the same device after a reload", async () => {
    const first = (await import("./deviceKey")).deviceKey();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    vi.resetModules();
    expect((await import("./deviceKey")).deviceKey()).toBe(first);
  });

  it("replaces a kept value that is not a key, rather than sending it", async () => {
    store.set("silvicom.device-key", "'; drop table x; --");
    expect((await import("./deviceKey")).deviceKey()).toMatch(/^[a-f0-9]{32}$/);
  });

  it("still gives one key for the page where storage is refused", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } });
    const mod = await import("./deviceKey");
    expect(mod.deviceKey()).toMatch(/^[a-f0-9]{32}$/);
    expect(mod.deviceKey()).toBe(mod.deviceKey());
  });
});

describe("every API call carries it", () => {
  it("apiFetch", async () => {
    const { apiFetch } = await import("./api");
    const { deviceKey } = await import("./deviceKey");
    await apiFetch("/api/me");
    expect(sent()).toBe(deviceKey());
  });

  it("fetchObjectUrl and apiDownload — a download can be a new session's first request", async () => {
    // Only what the downloads touch; the rest of URL stays the real one (the API base is parsed with it).
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    vi.stubGlobal("document", { createElement: () => ({ click: () => undefined, remove: () => undefined }), body: { appendChild: () => undefined } });
    const { fetchObjectUrl, apiDownload } = await import("./api");
    const { deviceKey } = await import("./deviceKey");
    await fetchObjectUrl("/api/x.pdf").catch(() => undefined);
    await apiDownload("/api/x.csv", "x.csv").catch(() => undefined);
    expect([sent(0), sent(1)]).toEqual([deviceKey(), deviceKey()]);
  });
});
