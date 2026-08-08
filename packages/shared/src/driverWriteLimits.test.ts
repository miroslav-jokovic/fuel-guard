import { describe, expect, it } from "vitest";
import {
  DRIVER_WRITE_LIMITS, RATE_WINDOW_MS,
  driverWriteBucket, hitWindow, secondsUntilUtcMidnight,
} from "./driverWriteLimits.js";

/**
 * D57's limits. The bucket resolver is the part most likely to be silently wrong — a route that
 * stops matching is not an error, it is an unlimited endpoint, which is exactly the state this whole
 * change exists to leave behind.
 */

const ID = "3f2b9a10-5c1e-4d9b-8e77-2a1f6c0b4d55";

describe("driverWriteBucket", () => {
  it.each([
    ["/api/me/shift/start", "shift"],
    ["/api/me/shift/equipment", "shift"],
    ["/api/me/shift/end", "shift"],
    [`/api/me/loads/${ID}/accept`, "load_action"],
    [`/api/me/loads/${ID}/decline`, "load_action"],
    [`/api/me/loads/${ID}/start`, "load_action"],
    [`/api/me/loads/${ID}/stops/${ID}`, "stop_capture"],
    ["/api/messages", "message"],
    [`/api/messages/${ID}/messages`, "message"],
  ])("buckets POST %s as %s", (path, bucket) => {
    expect(driverWriteBucket("POST", path)).toBe(bucket);
  });

  it("ignores reads — a limit on GET would throttle a driver looking at their own day", () => {
    expect(driverWriteBucket("GET", "/api/me/shift/start")).toBeNull();
    expect(driverWriteBucket("GET", `/api/me/loads/${ID}/stops/${ID}`)).toBeNull();
  });

  it.each([
    "/api/me/driver",
    "/api/me/loads",
    "/api/me/delete-account",
    `/api/me/loads/${ID}`,
    "/api/me/hazmat/capture",
    "/api/dispatch/loads",
    `/api/messages/${ID}/read`,
  ])("leaves %s unbucketed", (path) => {
    expect(driverWriteBucket("POST", path)).toBeNull();
  });

  it("is not fooled by a trailing slash, a query string or a doubled slash", () => {
    expect(driverWriteBucket("POST", "/api/me/shift/start/")).toBe("shift");
    expect(driverWriteBucket("POST", "/api/me/shift/start?retry=1")).toBe("shift");
    expect(driverWriteBucket("POST", "//api/me/shift/start")).toBe("shift");
  });

  it("accepts a lowercase method", () => {
    expect(driverWriteBucket("post", "/api/me/shift/end")).toBe("shift");
  });
});

describe("DRIVER_WRITE_LIMITS", () => {
  it("carries D57's numbers exactly", () => {
    expect(DRIVER_WRITE_LIMITS.shift).toMatchObject({ perMinute: 10, perDay: 60 });
    expect(DRIVER_WRITE_LIMITS.load_action).toMatchObject({ perMinute: 20, perDay: 200 });
    expect(DRIVER_WRITE_LIMITS.stop_capture).toMatchObject({ perMinute: 30, perDay: 500 });
    expect(DRIVER_WRITE_LIMITS.message).toMatchObject({ perMinute: 20, perDay: 300 });
  });

  it("keeps every per-day cap above its per-minute limit", () => {
    // A cap below the burst limit would make the per-minute window unreachable and the two codes
    // indistinguishable in practice.
    for (const l of Object.values(DRIVER_WRITE_LIMITS)) expect(l.perDay).toBeGreaterThan(l.perMinute);
  });
});

describe("hitWindow", () => {
  const T0 = 1_770_000_000_000;

  it("allows exactly `limit` requests and refuses the next", () => {
    let state = undefined as undefined | ReturnType<typeof hitWindow>["state"];
    for (let i = 1; i <= 3; i++) {
      const v = hitWindow(state, 3, T0);
      expect(v.allowed).toBe(true);
      state = v.state;
    }
    expect(hitWindow(state, 3, T0).allowed).toBe(false);
  });

  it("reopens once the window has passed", () => {
    const first = hitWindow(undefined, 1, T0);
    expect(hitWindow(first.state, 1, T0 + 1).allowed).toBe(false);
    const reopened = hitWindow(first.state, 1, T0 + RATE_WINDOW_MS);
    expect(reopened.allowed).toBe(true);
    expect(reopened.state.count).toBe(1);
  });

  it("reports a Retry-After that shrinks as the window drains, and never reaches zero", () => {
    const opened = hitWindow(undefined, 1, T0);
    expect(opened.retryAfterSec).toBe(60);
    expect(hitWindow(opened.state, 1, T0 + 30_000).retryAfterSec).toBe(30);
    // A caller told to retry after 0 seconds retries immediately and is refused again.
    expect(hitWindow(opened.state, 1, T0 + 59_999).retryAfterSec).toBe(1);
  });

  it("counts per key by keeping state out of the module — two drivers never share a bucket", () => {
    // The map lives in the middleware; this asserts the shape that makes per-key isolation possible.
    const driverA = hitWindow(undefined, 1, T0);
    const driverB = hitWindow(undefined, 1, T0);
    expect(driverA.allowed).toBe(true);
    expect(driverB.allowed).toBe(true);
  });
});

describe("secondsUntilUtcMidnight", () => {
  it("counts to the next UTC midnight", () => {
    expect(secondsUntilUtcMidnight(Date.UTC(2026, 7, 8, 23, 59, 0))).toBe(60);
    expect(secondsUntilUtcMidnight(Date.UTC(2026, 7, 8, 0, 0, 0))).toBe(86_400);
  });

  it("never returns zero", () => {
    expect(secondsUntilUtcMidnight(Date.UTC(2026, 7, 8, 23, 59, 59, 500))).toBeGreaterThanOrEqual(1);
  });
});
