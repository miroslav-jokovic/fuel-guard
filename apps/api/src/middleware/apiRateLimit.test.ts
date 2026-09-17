import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { closeTestServer } from "../testing/httpServer.js";
import {
  apiRateLimitKey,
  apiAddressKey,
  API_RATE_LIMIT_PER_CALLER,
  API_RATE_LIMIT_PER_ADDRESS,
} from "./apiRateLimit.js";

/**
 * C1 — the general `/api` budget is divided per CALLER, not per address.
 *
 * ── WHAT WENT WRONG, AND WHY NO TEST SAW IT ─────────────────────────────────────────────────────
 * The limiter was express-rate-limit's default, which keys on IP. Every dispatcher in one office
 * shares one address, and the live map polls every 5 s — so the office shared 600 requests per
 * quarter-hour and 30 dispatchers were hard-refused 100.1 seconds after opening the board. Nothing
 * was wrong with any single request, which is exactly why a suite of single-request tests could not
 * notice: the defect only exists BETWEEN two callers.
 *
 * So these assertions are all about two principals at once. A test that sent one request and checked
 * for a 200 would have passed against the broken version and against this one.
 */

const asReq = (headers: Record<string, string>, ip = "203.0.113.7") =>
  ({
    ip,
    get: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;

describe("which bucket a request counts against", () => {
  /**
   * ⚠⚠ THE DEFECT, STATED AS ONE ASSERTION. Two dispatchers, one office address. If these two keys
   * are equal the office shares a budget, which is the bug that refused 30 people mid-shift.
   */
  it("gives two dispatchers on one office address separate buckets", () => {
    const ana = apiRateLimitKey(asReq({ authorization: "Bearer token-ana" }, "203.0.113.7"));
    const luis = apiRateLimitKey(asReq({ authorization: "Bearer token-luis" }, "203.0.113.7"));
    expect(ana).not.toBe(luis);
  });

  /**
   * The other half, and the reason the key is the credential rather than something per-connection: a
   * caller must not be able to buy themselves a fresh allowance by changing address. One person on
   * the office wifi and then on their phone is the same person spending the same budget.
   */
  it("keeps one caller on one bucket even when their address changes", () => {
    const office = apiRateLimitKey(asReq({ authorization: "Bearer token-ana" }, "203.0.113.7"));
    const tethered = apiRateLimitKey(asReq({ authorization: "Bearer token-ana" }, "198.51.100.42"));
    expect(office).toBe(tethered);
  });

  /**
   * ⚠ Public traffic keeps the OLD behaviour deliberately. An unauthenticated caller has no identity
   * but their address, and those surfaces — the login exchange, public invites — are the real abuse
   * targets. Keying them per-request would have meant no limit at all.
   */
  it("falls back to the address when there is no credential to key on", () => {
    const a = apiRateLimitKey(asReq({}, "203.0.113.7"));
    const b = apiRateLimitKey(asReq({}, "198.51.100.42"));
    expect(a).toBe(apiRateLimitKey(asReq({}, "203.0.113.7")));
    expect(a).not.toBe(b);
    expect(a.startsWith("ip:")).toBe(true);
  });

  /**
   * ⚠ A bearer token is a CREDENTIAL, and a rate-limit key is a map key that outlives the request and
   * can end up in a store dump or a debug print. The digest is one-way; this asserts the raw secret
   * is nowhere in the key.
   */
  it("never puts the raw token in the key", () => {
    const key = apiRateLimitKey(asReq({ authorization: "Bearer super-secret-token" }));
    expect(key).not.toContain("super-secret-token");
    expect(key).toBe(
      `tok:${createHash("sha256").update("super-secret-token").digest("hex").slice(0, 32)}`,
    );
  });

  it("reads the scheme case-insensitively and ignores surrounding space", () => {
    const canonical = apiRateLimitKey(asReq({ authorization: "Bearer token-ana" }));
    expect(apiRateLimitKey(asReq({ authorization: "bearer  token-ana  " }))).toBe(canonical);
  });

  /**
   * A malformed or non-bearer credential has no caller in it, so it must fall back rather than key on
   * the literal header — otherwise anybody could mint buckets by varying a `Basic` string.
   */
  it("treats a non-bearer authorization header as no credential at all", () => {
    expect(apiRateLimitKey(asReq({ authorization: "Basic abc123" })).startsWith("ip:")).toBe(true);
    expect(apiRateLimitKey(asReq({ authorization: "Bearer" })).startsWith("ip:")).toBe(true);
  });

  /** The ceiling is per address whatever the caller carries — that is the whole point of it. */
  it("counts the address ceiling by address, credential or not", () => {
    const withToken = apiAddressKey(asReq({ authorization: "Bearer token-ana" }, "203.0.113.7"));
    const without = apiAddressKey(asReq({}, "203.0.113.7"));
    expect(withToken).toBe(without);
    expect(without).not.toBe(apiAddressKey(asReq({}, "198.51.100.42")));
  });

  /**
   * ⚠ The ceiling must be sized on MEASURED usage, not on the per-caller budget times the seats it
   * supports — multiplying two safety margins together produces no ceiling at all. This pins the
   * relationship rather than the numbers: the ceiling is well above one caller and well below the
   * product of the two.
   */
  it("sizes the address ceiling between one caller and thirty caller-budgets", () => {
    expect(API_RATE_LIMIT_PER_ADDRESS).toBeGreaterThan(API_RATE_LIMIT_PER_CALLER);
    expect(API_RATE_LIMIT_PER_ADDRESS).toBeLessThan(API_RATE_LIMIT_PER_CALLER * 30);
  });

  /**
   * A dispatcher spends 180 requests per quarter-hour on the 5-second board poll alone, before a
   * single tile. A budget that did not clear that with room is the old bug at a different number.
   */
  it("leaves room for a dispatcher's measured poll rate", () => {
    const pollsPerWindow = (15 * 60) / 5;
    expect(pollsPerWindow).toBe(180);
    expect(API_RATE_LIMIT_PER_CALLER).toBeGreaterThan(pollsPerWindow * 3);
  });
});

/**
 * The limiter is WIRED to those keys, which is a separate question from the keys being right.
 *
 * ⚠ Asserted through the `draft-7` `RateLimit` header rather than by exhausting the budget. The
 * per-caller limit is 1 200, so a test that drained it would be 1 200 requests of suite to observe a
 * counter the library already reports — and the thing that can actually rot is `keyGenerator` being
 * dropped from the options, which the header shows on the second request.
 */
describe("the mounted limiter uses those buckets", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeTestServer(server);
    server = undefined;
  });

  async function open(): Promise<string> {
    const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    server = app.listen(0);
    await new Promise<void>((r) => server!.once("listening", () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  /** `remaining=` out of the draft-7 `RateLimit` header, which is the counter for THIS caller. */
  const remaining = (res: Response): number =>
    Number(/remaining=(\d+)/.exec(res.headers.get("ratelimit") ?? "")?.[1] ?? NaN);

  it("counts two dispatchers on one address down separate budgets", async () => {
    const base = await open();
    const call = (token: string) =>
      fetch(`${base}/api/version`, {
        headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.7" },
      });

    const ana1 = remaining(await call("token-ana"));
    const luis1 = remaining(await call("token-luis"));
    const ana2 = remaining(await call("token-ana"));

    expect(ana1).toBe(API_RATE_LIMIT_PER_CALLER - 1);
    // ⚠ The assertion the bug fails. Sharing a bucket, Luis's first request would read one LOWER
    // than Ana's — he would be paying for her poll.
    expect(luis1).toBe(API_RATE_LIMIT_PER_CALLER - 1);
    expect(ana2).toBe(API_RATE_LIMIT_PER_CALLER - 2);
  });

  it("still pools unauthenticated callers on one address", async () => {
    const base = await open();
    const call = () => fetch(`${base}/api/version`, { headers: { "x-forwarded-for": "198.51.100.9" } });
    const first = remaining(await call());
    const second = remaining(await call());
    expect(second).toBe(first - 1);
  });
});
