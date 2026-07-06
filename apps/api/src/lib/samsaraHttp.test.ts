import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backoffMs, parseRetryAfter, samsaraFetch, __resetSamsaraPacing } from "./samsaraHttp.js";
import type { Env } from "../env.js";

const env = { SAMSARA_MAX_RPS: 1000, SAMSARA_MAX_RETRIES: 4 } as unknown as Env; // high rps → no pacing waits

const jsonRes = (status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ ok: status < 400 }), { status, headers });

beforeEach(() => __resetSamsaraPacing());

describe("backoffMs", () => {
  it("grows with attempt and stays within [exp/2, exp] and the cap", () => {
    const a0 = backoffMs(0, 500, 15000); // exp 500 → 250..500
    expect(a0).toBeGreaterThanOrEqual(250);
    expect(a0).toBeLessThanOrEqual(500);
    const a3 = backoffMs(3, 500, 15000); // exp 4000 → 2000..4000
    expect(a3).toBeGreaterThanOrEqual(2000);
    expect(a3).toBeLessThanOrEqual(4000);
    const big = backoffMs(20, 500, 15000); // capped at 15000 → 7500..15000
    expect(big).toBeLessThanOrEqual(15000);
    expect(big).toBeGreaterThanOrEqual(7500);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds to ms", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
  });
  it("parses an HTTP date to a non-negative delay", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(3000);
  });
  it("returns null for missing/garbage", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });
});

describe("samsaraFetch retry loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a 429 (honoring Retry-After) then returns the 200", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonRes(429, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonRes(200));
    const p = samsaraFetch(env, "tok", "https://api.samsara.test/x", { fetchImpl });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Bearer token is attached.
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("retries 5xx up to the cap then returns the last (failing) response for the caller to throw", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonRes(503));
    const p = samsaraFetch(env, "tok", "https://api.samsara.test/x", { fetchImpl });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(5); // initial + 4 retries
  });

  it("retry:false returns the raw 429 without retrying (diagnostics mode)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonRes(429));
    const p = samsaraFetch(env, "tok", "https://api.samsara.test/x", { fetchImpl, retry: false });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable 4xx (e.g. 403 missing scope)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonRes(403));
    const p = samsaraFetch(env, "tok", "https://api.samsara.test/x", { fetchImpl });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
