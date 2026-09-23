import { afterEach, describe, expect, it } from "vitest";
import { SoapDeadlineError, __resetSoapPacing, laneTimeoutMs, soapFetch, soapLaneRps } from "./soapClient.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * Two capabilities added for card control, both of which had to leave the existing pollers untouched:
 * a third priority lane, and a per-request deadline. Before the deadline existed, NEITHER dispatch
 * branch set one — a half-open socket to EFS hung until the process died.
 */

const env = testEnv({
  EFS_SOAP_MAX_RPS: 2,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
});

const url = "https://ws.efsllc.com/axis2/services/CardManagementWS/";

describe("priority lanes", () => {
  it("leaves the live/backfill split exactly as it was", () => {
    // The pollers' budget must not move the day card control ships. 70/30 of EFS_SOAP_MAX_RPS.
    expect(soapLaneRps(env, "live")).toBeCloseTo(1.4);
    expect(soapLaneRps(env, "backfill")).toBeCloseTo(0.6);
    expect(soapLaneRps(env, "live") + soapLaneRps(env, "backfill")).toBeCloseTo(env.EFS_SOAP_MAX_RPS);
  });

  it("gives interactive its OWN budget rather than a third slice", () => {
    const withRps = testEnv({ ...env, EFS_SOAP_INTERACTIVE_RPS: 3 });
    expect(soapLaneRps(withRps, "interactive")).toBe(3);
    // Adding the lane did not take anything away from the pollers.
    expect(soapLaneRps(withRps, "live")).toBeCloseTo(1.4);
    expect(soapLaneRps(withRps, "backfill")).toBeCloseTo(0.6);
  });

  it("defaults interactive to 1 rps on an Env that predates the key", () => {
    expect(soapLaneRps(env, "interactive")).toBe(1);
  });

  it("never returns a zero rate, which would stall a lane forever", () => {
    const tiny = testEnv({ ...env, EFS_SOAP_MAX_RPS: 0.1, EFS_SOAP_INTERACTIVE_RPS: 0.1 });
    for (const lane of ["live", "backfill", "interactive"] as const) {
      expect(soapLaneRps(tiny, lane)).toBeGreaterThan(0);
    }
  });
});

describe("lane timeouts", () => {
  it("gives a waiting human a tighter deadline than an unwatched backfill", () => {
    const configured = testEnv({ ...env, EFS_SOAP_TIMEOUT_MS: 20_000, EFS_SOAP_INTERACTIVE_TIMEOUT_MS: 10_000 });
    expect(laneTimeoutMs(configured, "interactive")).toBe(10_000);
    expect(laneTimeoutMs(configured, "live")).toBe(20_000);
    expect(laneTimeoutMs(configured, "backfill")).toBe(20_000);
  });

  it("falls back to documented defaults rather than NaN on a partial Env", () => {
    expect(laneTimeoutMs(env, "interactive")).toBe(10_000);
    expect(laneTimeoutMs(env, "live")).toBe(20_000);
  });
});

describe("soapFetch deadlines", () => {
  afterEach(() => __resetSoapPacing());

  it("attaches an AbortSignal to the fetch branch", async () => {
    let seen: AbortSignal | null | undefined;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      seen = init?.signal;
      return new Response("<ok/>", { status: 200 });
    }) as typeof fetch;

    await soapFetch(env, "k", { url, body: "<x/>", fetchImpl, priority: "interactive" });
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it("honours an explicit timeoutMs over the lane default", async () => {
    // A caller that hands us its own deadline (the card-write orchestration does) must win.
    let aborted = false;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      aborted = init?.signal?.aborted ?? false;
      return new Response("<ok/>", { status: 200 });
    }) as typeof fetch;

    await soapFetch(env, "k2", { url, body: "<x/>", fetchImpl, timeoutMs: 20 });
    expect(aborted).toBe(true);
  });

  it("lets an explicit 0 disable the deadline entirely", async () => {
    let seen: AbortSignal | null | undefined = null;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      seen = init?.signal;
      return new Response("<ok/>", { status: 200 });
    }) as typeof fetch;

    await soapFetch(env, "k3", { url, body: "<x/>", fetchImpl, timeoutMs: 0 });
    expect(seen).toBeUndefined();
  });

  it("treats a timeout as transient and retries it — but ONLY when retries are allowed", async () => {
    const retrying = testEnv({ ...env, EFS_SOAP_MAX_RETRIES: 2 });
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls <= 2) throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
      return new Response("<ok/>", { status: 200 });
    }) as typeof fetch;

    await soapFetch(retrying, "k4", { url, body: "<x/>", fetchImpl: flaky });
    expect(calls).toBe(3);

    // `retry: false` is what every state-MUTATING call passes, because a timed-out write may have
    // landed and retrying it is a second write. Reconciliation is by re-read, never by retry.
    calls = 0;
    await expect(
      soapFetch(retrying, "k5", { url, body: "<x/>", fetchImpl: flaky, retry: false }),
    ).rejects.toBeInstanceOf(Error);
    expect(calls).toBe(1);
  });
});

/**
 * A fetch that behaves like the real one about `signal`: it rejects at once on an aborted signal, and
 * rejects with the signal's reason when it fires mid-request. The stub above ignores `signal`, so it
 * could not see that every retry after a timeout went out on the SAME, already-fired signal.
 */
const hangThenAnswer = (hangs: number) => {
  const seen = { calls: 0, abortedOnArrival: 0 };
  const fetchImpl = ((_input: string | URL, init?: RequestInit) => {
    seen.calls++;
    const signal = init?.signal;
    if (signal?.aborted) {
      seen.abortedOnArrival++;
      return Promise.reject(signal.reason);
    }
    if (seen.calls > hangs) return Promise.resolve(new Response("<ok/>", { status: 200 }));
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
  return { seen, fetchImpl };
};

describe("soapFetch deadlines are per attempt (2026-09-23, ••••6122)", () => {
  afterEach(() => __resetSoapPacing());
  const fast = testEnv({ ...env, EFS_SOAP_MAX_RPS: 100, EFS_SOAP_MAX_RETRIES: 2 });

  it("gives a retry after a timeout its own deadline, so the retry can succeed", async () => {
    const { seen, fetchImpl } = hangThenAnswer(1);
    const res = await soapFetch(fast, "d1", { url, body: "<x/>", fetchImpl, timeoutMs: 30 });
    expect(res.status).toBe(200);
    expect(seen.calls).toBe(2);
    expect(seen.abortedOnArrival).toBe(0);
  });

  it("names a timeout as a timeout once the retries are spent", async () => {
    const { fetchImpl } = hangThenAnswer(99);
    const failure = await soapFetch(fast, "d2", { url, body: "<x/>", fetchImpl, timeoutMs: 30 }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SoapDeadlineError);
    expect(failure).toMatchObject({ reason: "timeout", timeoutMs: 30 });
  });

  it("names the caller's deadline as the caller's, and does not retry past it", async () => {
    const { seen, fetchImpl } = hangThenAnswer(99);
    const failure = await soapFetch(fast, "d3", {
      url, body: "<x/>", fetchImpl, timeoutMs: 5_000, signal: AbortSignal.timeout(30),
    }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ reason: "caller" });
    expect(seen.calls).toBe(1);
  });
});
