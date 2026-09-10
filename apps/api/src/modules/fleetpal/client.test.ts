import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FleetpalClient } from "./client.js";
import { FleetpalError, parseRetryAfter, RATE_LIMIT_FALLBACK_SEC } from "./errors.js";

/**
 * The FleetPal HTTP client (FLEETPAL-INTEGRATION-PLAN.md F3).
 *
 * ── ⚠ THE FOUR ASSERTIONS THIS FILE EXISTS FOR ─────────────────────────────────────────────────
 * Each is a way of losing data or stalling a sweep that leaves no trace:
 *
 *   1. **PAGING BY OFFSET.** The vendor orders newest-first and warns that rows added mid-walk shift
 *      items between pages, so `?offset=` both SKIPS and REPEATS rows — silently, and in proportion
 *      to how busy the shop is, which is exactly when the sweep matters. The assertion is on the
 *      REQUEST: the second url must be the one the vendor handed back, verbatim, and no url the
 *      client builds may carry an `offset`.
 *   2. **A 429 TREATED AS A FAILURE.** It is the vendor's documented request to slow down. A sweep
 *      that abandoned on it would give up on data they were willing to serve a second later.
 *   3. **A 400 RETRIED.** The same body fails identically forever; a retry loop on a validation
 *      error is an outage that presents as a slow sync.
 *   4. **A REQUEST WITH NO DEADLINE.** One hung connection holds a scheduler tick open for ever and
 *      the symptom is "the sync stopped" with nothing in the logs.
 *
 * The fixtures are shaped from the vendor's documented examples rather than invented, so F4 —
 * which replaces them with payloads recorded from the live account — is a substitution, not a
 * rewrite.
 */

const item = z.looseObject({ id: z.string() });

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: Error;
}

/** A fetch that replays scripted replies in order and records the urls it was asked for. */
function scriptedFetch(replies: Reply[]): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (input: unknown) => {
    urls.push(String(input));
    const reply = replies[Math.min(i++, replies.length - 1)]!;
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => reply.headers?.[h.toLowerCase()] ?? null },
      json: async () => reply.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const page = (results: unknown[], next: string | null) => ({
  count: results.length,
  next,
  previous: null,
  results,
});

const clientWith = (replies: Reply[], opts: Partial<{ maxRetries: number }> = {}) => {
  const { impl, urls } = scriptedFetch(replies);
  const slept: number[] = [];
  const client = new FleetpalClient({
    apiKey: "fp_test_key",
    baseUrl: "https://openapi.fleetpal.io",
    fetchImpl: impl,
    // Injected so a backoff assertion does not take its own delay to run — the alternative is a
    // test that is slow for the same reason it is correct, which is how a suite stops being run.
    sleep: async (ms) => { slept.push(ms); },
    ...opts,
  });
  return { client, urls, slept };
};

describe("authentication and addressing", () => {
  it("sends the key as a bearer token", async () => {
    let seen: Record<string, string> | undefined;
    const impl = (async (_i: unknown, init?: { headers?: Record<string, string> }) => {
      seen = init?.headers;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "U1" }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = new FleetpalClient({ apiKey: "fp_test_key", baseUrl: "https://openapi.fleetpal.io", fetchImpl: impl });
    await client.get("/v1/units/U1", item);
    expect(seen?.Authorization).toBe("Bearer fp_test_key");
  });

  it("follows an absolute url as given rather than re-basing it", async () => {
    // The vendor's own instruction: follow the url on the object instead of templating a path out
    // of an id, so a collection moving does not break us.
    const { client, urls } = clientWith([{ body: { id: "U1" } }]);
    await client.get("https://openapi.fleetpal.io/v1/units/U1", item);
    expect(urls[0]).toBe("https://openapi.fleetpal.io/v1/units/U1");
  });

  it("tolerates a base url with a trailing slash", async () => {
    const { impl, urls } = scriptedFetch([{ body: { id: "U1" } }]);
    const client = new FleetpalClient({ apiKey: "k", baseUrl: "https://openapi.fleetpal.io/", fetchImpl: impl });
    await client.get("/v1/units/U1", item);
    expect(urls[0]).toBe("https://openapi.fleetpal.io/v1/units/U1");
  });
});

describe("walking a collection", () => {
  it("⚠ follows `next` and never computes an offset", async () => {
    const { client, urls } = clientWith([
      { body: page([{ id: "A" }, { id: "B" }], "https://openapi.fleetpal.io/v1/units?limit=200&cursor=2") },
      { body: page([{ id: "C" }], null) },
    ]);
    const rows = await client.walk("/v1/units", item);
    expect(rows.map((r) => r.id)).toEqual(["A", "B", "C"]);
    // The second request is the url the VENDOR gave, verbatim. A client incrementing offset would
    // ask for `offset=200` here and, because results are newest-first, would skip and repeat rows
    // in proportion to how busy the shop is.
    expect(urls[1]).toBe("https://openapi.fleetpal.io/v1/units?limit=200&cursor=2");
    expect(urls.some((u) => u.includes("offset="))).toBe(false);
  });

  it("asks for the largest page the vendor will serve", async () => {
    const { client, urls } = clientWith([{ body: page([], null) }]);
    await client.walk("/v1/units", item);
    // 200 is the documented cap; the vendor clamps rather than rejects above it, so asking for more
    // just wastes the round trip.
    expect(urls[0]).toContain("limit=200");
  });

  it("passes a caller's filters through and keeps its own limit out of the way", async () => {
    const { client, urls } = clientWith([{ body: page([], null) }]);
    await client.walk("/v1/work-orders", item, { updated_after: "2026-09-01T00:00:00Z", limit: 50 });
    expect(urls[0]).toContain("updated_after=2026-09-01T00%3A00%3A00Z");
    expect(urls[0]).toContain("limit=50");
  });

  it("drops an undefined filter rather than sending the string 'undefined'", async () => {
    // A never-run resource has no watermark, and `updated_after=undefined` is a request the vendor
    // would reject — turning "first full sweep" into a hard failure on day one.
    const { client, urls } = clientWith([{ body: page([], null) }]);
    await client.walk("/v1/units", item, { updated_after: undefined });
    expect(urls[0]).not.toContain("updated_after");
  });

  it("⚠ refuses a `next` it has already served, rather than looping for ever", async () => {
    const self = "https://openapi.fleetpal.io/v1/units?limit=200";
    const { client } = clientWith([{ body: page([{ id: "A" }], self) }]);
    // A vendor bug or a proxy rewriting `next` would otherwise hold a scheduler tick open for ever,
    // and the symptom would be "the sync stopped" with nothing in the logs.
    await expect(client.walk("/v1/units?limit=200", item)).rejects.toThrow(/already served/);
  });

  it("stops at the page guard", async () => {
    let n = 0;
    const impl = (async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => page([{ id: `R${n}` }], `https://openapi.fleetpal.io/v1/units?p=${++n}`),
    })) as unknown as typeof fetch;
    const client = new FleetpalClient({ apiKey: "k", baseUrl: "https://openapi.fleetpal.io", fetchImpl: impl });
    await expect(client.walk("/v1/units", item, {}, 5)).rejects.toThrow(/exceeded 5 pages/);
  });
});

describe("the vendor's error vocabulary", () => {
  it("⚠ waits the time a 429 asks for, then resumes", async () => {
    const { client, slept } = clientWith([
      { status: 429, headers: { "retry-after": "7" }, body: { detail: "Rate limit exceeded" } },
      { body: page([{ id: "A" }], null) },
    ]);
    const rows = await client.walk("/v1/units", item);
    expect(rows.map((r) => r.id)).toEqual(["A"]);
    // The vendor's header wins over our own curve: they know their limiter, and an exponential
    // backoff ignoring it would either hammer them early or idle far longer than they asked.
    expect(slept).toEqual([7000]);
  });

  it("does not turn an unreadable Retry-After into a hot loop", async () => {
    // `Number("Wed, 10 Sep 2026 …")` is NaN, and a `NaN ?? 0` that became a zero-second wait would
    // hammer the very endpoint that just asked us to slow down.
    expect(parseRetryAfter(null)).toBe(RATE_LIMIT_FALLBACK_SEC);
    expect(parseRetryAfter("not-a-number")).toBe(RATE_LIMIT_FALLBACK_SEC);
    expect(parseRetryAfter("7")).toBe(7);
  });

  it("⚠ never retries a 400 — the same body fails identically for ever", async () => {
    const { client, urls } = clientWith([
      { status: 400, body: { value: { message: "Value must be greater than or equal to 412000", code: "invalid" } } },
    ]);
    await expect(client.get("/v1/meters", item)).rejects.toMatchObject({ kind: "validation" });
    expect(urls).toHaveLength(1);
  });

  it("carries the field-keyed CODE, which is the half the vendor promises is stable", async () => {
    const { client } = clientWith([
      {
        status: 400,
        body: {
          value: { message: "Value must be greater than or equal to 412000", code: "invalid" },
          non_field_errors: { message: "Meter type ODOMETER is not tracked for this unit", code: "invalid" },
        },
      },
    ]);
    const err = await client.get("/v1/meters", item).catch((e: FleetpalError) => e);
    // Messages "may be reworded"; codes are safe to branch on. A client keyed off message text
    // works until somebody makes a copy edit.
    expect((err as FleetpalError).codes).toEqual({ value: "invalid", non_field_errors: "invalid" });
  });

  it("stops on a dead key rather than retrying an auth endpoint", async () => {
    const { client, urls } = clientWith([{ status: 401, body: { detail: "Invalid API key." } }]);
    const err = await client.get("/v1/units", item).catch((e: FleetpalError) => e);
    expect((err as FleetpalError).kind).toBe("auth");
    expect((err as FleetpalError).retryable).toBe(false);
    expect(urls).toHaveLength(1);
  });

  it("stops on a role that cannot read the resource", async () => {
    // Keys are issued per user and carry that user's role, so a 403 is a support ticket rather than
    // a bug — and retrying it just spends the rate limit.
    const { client, urls } = clientWith([{ status: 403, body: { detail: "Not permitted." } }]);
    await expect(client.get("/v1/work-orders", item)).rejects.toMatchObject({ kind: "forbidden" });
    expect(urls).toHaveLength(1);
  });

  it("retries a 5xx with a growing pause, and gives up bounded", async () => {
    const { client, slept } = clientWith([{ status: 503, body: null }], { maxRetries: 3 });
    await expect(client.get("/v1/units", item)).rejects.toMatchObject({ kind: "server" });
    // Exponential from one second. Bounded, because an endpoint failing for ever is a configuration
    // problem and looping on it is how one org's sweep starves every other org's.
    expect(slept).toEqual([1000, 2000, 4000]);
  });

  it("keeps the status when the error body is not JSON at all", async () => {
    // A proxy's HTML error page must not turn a diagnosable 401 into an unexplained crash.
    const impl = (async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    })) as unknown as typeof fetch;
    const client = new FleetpalClient({ apiKey: "k", baseUrl: "https://openapi.fleetpal.io", fetchImpl: impl });
    const err = await client.get("/v1/units", item).catch((e: FleetpalError) => e);
    expect((err as FleetpalError).kind).toBe("auth");
    expect((err as FleetpalError).status).toBe(401);
  });

  it("⚠ treats a hung connection as a bounded failure rather than waiting for ever", async () => {
    const aborted = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const { client } = clientWith([{ throws: aborted }], { maxRetries: 1 });
    const err = await client.get("/v1/units", item).catch((e: FleetpalError) => e);
    expect((err as FleetpalError).kind).toBe("transport");
    expect((err as FleetpalError).retryable).toBe(true);
  });

  it("does not retry a response that failed the contract — that is our bug or their change", async () => {
    const { client, urls } = clientWith([{ body: { nope: true } }]);
    await expect(client.get("/v1/units/U1", item)).rejects.toMatchObject({ kind: "validation" });
    expect(urls).toHaveLength(1);
  });
});

describe("the request log", () => {
  it("records every attempt, so a failed sweep is visible without log-diving", async () => {
    const { client } = clientWith([
      { status: 429, headers: { "retry-after": "1" }, body: { detail: "slow down" } },
      { body: page([{ id: "A" }], null) },
    ]);
    await client.walk("/v1/units", item);
    expect(client.log).toHaveLength(2);
    expect(client.log[0]).toMatchObject({ status: 429, attempts: 1 });
    expect(client.log[1]).toMatchObject({ status: 200, error: null });
  });

  it("never puts the api key in the log", async () => {
    const { client } = clientWith([{ body: page([], null) }]);
    await client.walk("/v1/units", item);
    // The log is written to `fleetpal_sync_state.last_error` and read by an operator; a key that
    // reached it would be a credential in a column that was never meant to hold one.
    expect(JSON.stringify(client.log)).not.toContain("fp_test_key");
  });
});
