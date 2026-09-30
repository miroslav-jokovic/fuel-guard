import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `apiFetch`'s answer to `401 access_changed` (SP7, Q-SET6 (a)).
 *
 * The API refuses a signed token whose membership was removed, re-roled or suspended since it was
 * minted. What the browser must do then is the half of "removal is immediate" the person actually
 * sees: try a refresh (which fails, because the API also ended their sessions), and sign them out to
 * the login page. Every other refusal — including a plain 401 — must leave the session alone, or an
 * expired token on one request would sign somebody out of a working session.
 */

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./supabase", () => ({ supabase: { auth } }));
const clearStepUp = vi.hoisted(() => vi.fn());
vi.mock("./stepUp", () => ({ stepUpHeader: () => ({}), clearStepUp }));

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, statusText: "x", json: async () => body });

async function load() {
  vi.resetModules();
  return import("./api");
}

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "bearer-1" } } });
  auth.signOut.mockResolvedValue({ error: null });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  vi.stubGlobal("location", { assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("apiFetch on 401 access_changed", () => {
  const changed = { error: { code: "access_changed", message: "Your access to this organization has changed. Sign in again." } };

  it("signs the person out to the login page when the refresh fails — their sessions were ended", async () => {
    respond(401, changed);
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "Invalid Refresh Token" } });
    const { apiFetch } = await load();
    const res = await apiFetch("/api/fuel");
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(clearStepUp).toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).toHaveBeenCalledWith("/login");
    // The caller still gets the refusal it was given.
    expect(res).toMatchObject({ ok: false, status: 401, error: { code: "access_changed" } });
  });

  it("keeps the session when the refresh succeeds — the store's listener adopts the new token", async () => {
    respond(401, changed);
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "bearer-2" } }, error: null });
    const { apiFetch } = await load();
    const res = await apiFetch("/api/fuel");
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(res.error?.code).toBe("access_changed");
  });

  it("still sends them to the login page when the local sign-out itself throws", async () => {
    respond(401, changed);
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "gone" } });
    auth.signOut.mockRejectedValue(new Error("storage unavailable"));
    const { apiFetch } = await load();
    await expect(apiFetch("/api/fuel")).resolves.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("refreshes ONCE for a burst of refused requests, not once per request", async () => {
    respond(401, changed);
    let release!: (v: unknown) => void;
    auth.refreshSession.mockReturnValue(new Promise((r) => (release = r)));
    const { apiFetch } = await load();
    const burst = Promise.all([apiFetch("/a"), apiFetch("/b"), apiFetch("/c")]);
    await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalled());
    release({ data: { session: null }, error: { message: "gone" } });
    await burst;
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("does nothing to the session on a plain 401, or on a 403", async () => {
    const { apiFetch } = await load();
    respond(401, { error: { code: "unauthorized", message: "Invalid or expired token" } });
    await apiFetch("/api/fuel");
    respond(403, { error: { code: "access_changed", message: "not a 401" } });
    await apiFetch("/api/fuel");
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe("apiDownload's refusal keeps the API's code (SP9)", () => {
  // A download behind `requireFreshAuth` (the access-review export) must reach the page's
  // `holdForStepUp` as `step_up_required`; a bare sentence would only ever be toasted.
  it("throws an Error carrying code and message", async () => {
    respond(403, { error: { code: "step_up_required", message: "Confirm your password" } });
    const { apiDownload } = await load();
    const err = (await apiDownload("/api/access-review/export.csv", "a.csv").catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.message).toBe("Confirm your password");
    expect(err.code).toBe("step_up_required");
  });
});
