import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser step-up token (audit P0-4): a held token rides the next request, expires on its own,
 * and is cleared on sign-out. The property that matters — nothing but a server-verified password
 * puts a token in the holder, and a stale one never leaks into a header.
 */

const getSession = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { auth: { getSession } } }));

let fetchMock: ReturnType<typeof vi.fn>;

async function load() {
  // Fresh module state per test — the holder is module-level on purpose (a step-up is a moment).
  vi.resetModules();
  return import("./stepUp");
}

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "bearer-1" } } });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("verifyStepUp", () => {
  it("holds the token on success and emits it in the header", async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: "tok-abc", expiresAt }), { status: 200 }));
    const { verifyStepUp, stepUpHeader } = await load();

    expect(await verifyStepUp("hunter2")).toBe(true);
    expect(stepUpHeader()).toEqual({ "x-step-up-token": "tok-abc" });
    // The password went to our endpoint, once.
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/step-up", expect.objectContaining({ method: "POST" }));
  });

  it("returns false and holds nothing when the server refuses", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    const { verifyStepUp, stepUpHeader } = await load();
    expect(await verifyStepUp("wrong")).toBe(false);
    expect(stepUpHeader()).toEqual({});
  });

  it("stops emitting a token once it has expired", async () => {
    const expiresAt = new Date(Date.now() + 1_000).toISOString(); // inside the 5s margin → already stale
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: "tok-soon", expiresAt }), { status: 200 }));
    const { verifyStepUp, stepUpHeader } = await load();
    await verifyStepUp("hunter2");
    expect(stepUpHeader()).toEqual({}); // margin treats an about-to-expire token as gone
  });

  it("clearStepUp drops a held token (sign-out hook)", async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: "tok-abc", expiresAt }), { status: 200 }));
    const { verifyStepUp, stepUpHeader, clearStepUp } = await load();
    await verifyStepUp("hunter2");
    clearStepUp();
    expect(stepUpHeader()).toEqual({});
  });
});
