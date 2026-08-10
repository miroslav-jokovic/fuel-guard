import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  backoffMs,
  parseRetryAfter,
  samsaraFetch,
  laneRps,
  __resetSamsaraPacing,
} from "./samsaraHttp.js";
import type { Env } from "../env.js";

describe("laneRps — two-tier rate split (F5)", () => {
  const e = { SAMSARA_MAX_RPS: 20, SAMSARA_LIVE_RPS_FRACTION: 0.6 } as unknown as Env;
  it("reserves the live fraction for live and gives backfill the remainder; combined ≤ cap", () => {
    expect(laneRps(e, "live")).toBeCloseTo(12, 6); // 60% of 20
    expect(laneRps(e, "backfill")).toBeCloseTo(8, 6); // remaining 40%
    expect(laneRps(e, "live") + laneRps(e, "backfill")).toBeCloseTo(20, 6); // never exceeds the token cap
  });
  it("never drops a lane to zero even at extreme fractions", () => {
    const hot = { SAMSARA_MAX_RPS: 20, SAMSARA_LIVE_RPS_FRACTION: 1 } as unknown as Env;
    expect(laneRps(hot, "backfill")).toBeGreaterThanOrEqual(0.1);
  });

  it("honors a lower per-request cap without changing the lane split", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const starts: number[] = [];
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
        starts.push(Date.now());
        return jsonRes(200);
      });
      await samsaraFetch(e, "tok", "https://api.samsara.test/hos", {
        fetchImpl,
        maxRps: 5,
      });
      const second = samsaraFetch(e, "tok", "https://api.samsara.test/hos", {
        fetchImpl,
        maxRps: 5,
      });
      await vi.runAllTimersAsync();
      await second;
      expect(starts).toEqual([0, 200]);
      expect(laneRps(e, "live")).toBeCloseTo(12, 6);
    } finally {
      vi.useRealTimers();
    }
  });
});

const env = { SAMSARA_MAX_RPS: 1000, SAMSARA_MAX_RETRIES: 4 } as unknown as Env; // high rps → no pacing waits

describe("samsaraFetch — per-attempt deadline (incident 2026-08-10)", () => {
  beforeEach(() => __resetSamsaraPacing());

  it("passes an AbortSignal on every attempt, so a hung connection cannot burn 5 minutes", async () => {
    const signals: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      signals.push((init as RequestInit | undefined)?.signal);
      return jsonRes(200);
    });
    await samsaraFetch({ ...env, SAMSARA_REQUEST_TIMEOUT_MS: 120_000 } as unknown as Env, "tok", "https://api.samsara.test/x", { fetchImpl });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("treats a timed-out attempt as a retryable network error, not a fatal one", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(jsonRes(200));
    const res = await samsaraFetch(
      { ...env, SAMSARA_REQUEST_TIMEOUT_MS: 50 } as unknown as Env,
      "tok",
      "https://api.samsara.test/x",
      { fetchImpl },
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("omits the signal entirely when the deadline is disabled", async () => {
    const signals: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      signals.push((init as RequestInit | undefined)?.signal);
      return jsonRes(200);
    });
    await samsaraFetch({ ...env, SAMSARA_REQUEST_TIMEOUT_MS: 0 } as unknown as Env, "tok", "https://api.samsara.test/x", { fetchImpl });
    expect(signals[0]).toBeUndefined();
  });
});

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
