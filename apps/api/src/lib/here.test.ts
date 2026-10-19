import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../env.js";

// No waiting between attempts: the retry count is what is under test, not the backoff.
vi.mock("../modules/samsara/lib/samsaraHttp.js", () => ({ backoffMs: () => 0 }));

const { fetchTruckRoute, HereUnavailableError } = await import("./here.js");

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  HERE_API_KEY: "test",
} as NodeJS.ProcessEnv);
const req = {
  origin: { lat: 41.88, lng: -87.63 }, via: [], destination: { lat: 39.77, lng: -86.16 },
  profile: { heightIn: null, lengthIn: null, widthIn: null, axleCount: null, grossWeightLb: null },
  hazmat: [], tunnelCategory: null, avoidTunnels: false,
} as unknown as Parameters<typeof fetchTruckRoute>[1];

describe("fetchTruckRoute", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws HereUnavailableError when HERE answers 503 through every retry, as it did from 2026-10-16", async () => {
    const fetch = vi.fn(async () => new Response('{"error":"Temporary error","error_description":"Timeout processing request"}', { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchTruckRoute(env, req)).rejects.toBeInstanceOf(HereUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("throws HereUnavailableError when HERE cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(fetchTruckRoute(env, req)).rejects.toBeInstanceOf(HereUnavailableError);
  });

  it("does not call a refused request an outage: a 400 is a plain error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    const err = await fetchTruckRoute(env, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(HereUnavailableError);
  });
});
