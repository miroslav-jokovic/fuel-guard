import { afterEach, describe, expect, it, vi } from "vitest";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import {
  EfsSoapError,
  __resetEfsSessions,
  efsLogin,
  efsSessionDiagnostics,
  withEfsSession,
} from "./efsSoapSession.js";
import { __resetSoapPacing } from "./soapClient.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * The properties this file pins are the ones that keep us OUT of `AccountLockedException`. The EFS
 * service account is shared with transaction ingestion, so a login storm from card control does not
 * degrade card control — it stops the fuel feed. Every assertion below is about how many times we
 * are willing to ask the vendor for a session, and under what circumstances we stop asking at all.
 */

const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  // Same reason as efsSoap.test.ts: the SSRF gate would otherwise resolve ws.efsllc.com for real.
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
});

const creds: EfsSoapCredentials = {
  orgId: "org-1",
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user",
  soapPassword: "pass<&",
  accountId: null,
  postedLastCursor: null,
  rejectedLastCursor: null,
  postedLastPolledAt: null,
  rejectedLastPolledAt: null,
  postedLastSuccessAt: null,
  rejectedLastSuccessAt: null,
  postedLastError: null,
  rejectedLastError: null,
  enabled: true,
  fromEnvFallback: false,
  tls: null,
};

const otherOrg: EfsSoapCredentials = { ...creds, orgId: "org-2" };

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = (id = "session-1") => soap(`<loginResponse><result>${id}</result></loginResponse>`);
const fault = (text: string) => soap(`<soap:Fault><faultstring>${text}</faultstring></soap:Fault>`);
const dataOk = soap("<getCardResponse><result><value><status>Active</status></value></result></getCardResponse>");

interface Recorder {
  fetchImpl: typeof fetch;
  bodies: string[];
  cookies: (string | undefined)[];
  /** Requests whose body names the given operation element. */
  count(operation: string): number;
}

/** A stub that answers from a scripted queue, or with `fallback` once the script runs out. */
function recorder(script: string[], fallback = dataOk): Recorder {
  let index = 0;
  const bodies: string[] = [];
  const cookies: (string | undefined)[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const headers = new Headers(init?.headers ?? {});
    cookies.push(headers.get("cookie") ?? undefined);
    const body = script[index++] ?? fallback;
    // A login answer carries the session cookie EFS sets, so the jar assertions have something real.
    const responseHeaders = body.includes("loginResponse")
      ? { "set-cookie": `JSESSIONID=sess-${index}; Path=/; HttpOnly` }
      : undefined;
    return new Response(body, { status: 200, headers: responseHeaders });
  }) as typeof fetch;
  return {
    fetchImpl,
    bodies,
    cookies,
    count: (operation) => bodies.filter((b) => b.includes(`CardManagementEP_${operation}`)).length,
  };
}

describe("EFS session reuse", () => {
  afterEach(() => {
    __resetEfsSessions();
    __resetSoapPacing();
    vi.useRealTimers();
  });

  it("collapses ten concurrent operations into ONE login", async () => {
    const rec = recorder([loginOk()]);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        withEfsSession(env, creds, "interactive", async (s) => s.clientId, { fetchImpl: rec.fetchImpl }),
      ),
    );

    expect(results).toEqual(Array.from({ length: 10 }, () => "session-1"));
    // The single most important number in this file. Ten logins here is the shape that locks the account.
    expect(rec.count("login")).toBe(1);
  });

  it("reuses the cached session across sequential calls", async () => {
    const rec = recorder([loginOk()]);
    await withEfsSession(env, creds, "live", async () => 1, { fetchImpl: rec.fetchImpl });
    await withEfsSession(env, creds, "live", async () => 2, { fetchImpl: rec.fetchImpl });

    expect(rec.count("login")).toBe(1);
    expect(efsSessionDiagnostics(creds).hasSession).toBe(true);
  });

  it("uses a different session key when the password or active certificate changes", async () => {
    const rec = recorder([loginOk()]);
    await withEfsSession(env, creds, "live", async () => 1, { fetchImpl: rec.fetchImpl });

    expect(efsSessionDiagnostics(creds).hasSession).toBe(true);
    expect(efsSessionDiagnostics({ ...creds, soapPassword: "rotated" }).hasSession).toBe(false);
    expect(efsSessionDiagnostics({
      ...creds,
      tls: { source: "org", fingerprintSha256: "new-cert", rejectUnauthorized: true },
    }).hasSession).toBe(false);
  });

  it("resets every cached session for an org without affecting another org", async () => {
    const rec = recorder([loginOk("org-1-a"), loginOk("org-1-b"), loginOk("org-2")]);
    const sameOrgDifferentEndpoint = { ...creds, endpointUrl: "https://qa2.efsllc.com/axis2/services/CardManagementWS/" };
    await withEfsSession(env, creds, "live", async () => 1, { fetchImpl: rec.fetchImpl });
    await withEfsSession(env, sameOrgDifferentEndpoint, "live", async () => 1, { fetchImpl: rec.fetchImpl });
    await withEfsSession(env, otherOrg, "live", async () => 1, { fetchImpl: rec.fetchImpl });

    __resetEfsSessions("org-1");
    expect(efsSessionDiagnostics(creds).hasSession).toBe(false);
    expect(efsSessionDiagnostics(sameOrgDifferentEndpoint).hasSession).toBe(false);
    expect(efsSessionDiagnostics(otherOrg).hasSession).toBe(true);
  });

  it("does NOT log out at the end of a session-scoped operation", async () => {
    const rec = recorder([loginOk()]);
    await withEfsSession(env, creds, "live", async () => 1, { fetchImpl: rec.fetchImpl });

    // Logging out here would invalidate the token every other in-flight caller is holding.
    expect(rec.count("logout")).toBe(0);
  });

  it("keeps one cookie jar per org, and replays it on every request in the session", async () => {
    const rec = recorder([loginOk("s-1")]);
    await withEfsSession(env, creds, "live", async () => 1, { fetchImpl: rec.fetchImpl });

    // [0] is the login itself (no cookie yet); everything after carries the jar.
    expect(rec.cookies[0]).toBeUndefined();
    expect(rec.cookies.slice(1).every((c) => c?.startsWith("JSESSIONID="))).toBe(true);
  });

  it("isolates cookie jars between orgs sharing one connection pool", async () => {
    const rec = recorder([loginOk("a"), loginOk("b")]);
    const a = await withEfsSession(env, creds, "live", async (s) => s.cookie, { fetchImpl: rec.fetchImpl });
    const b = await withEfsSession(env, otherOrg, "live", async (s) => s.cookie, { fetchImpl: rec.fetchImpl });

    expect(rec.count("login")).toBe(2);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // The guide (p10) requires per-session isolation; appliances may block everyone if we blur them.
    expect(a).not.toEqual(b);
  });
});

describe("EFS session expiry", () => {
  afterEach(() => {
    __resetEfsSessions();
    __resetSoapPacing();
  });

  it("re-logs in EXACTLY once when EFS answers InvalidClientId, then succeeds", async () => {
    // The callback raises the vendor's expiry fault itself, so the only fetches are the two logins.
    const rec = recorder([loginOk("old"), loginOk("new")]);
    const seen: string[] = [];

    const result = await withEfsSession(
      env, creds, "interactive",
      async (session) => {
        seen.push(session.clientId);
        // First pass throws the vendor's expiry fault; the retry gets a fresh clientId.
        if (seen.length === 1) throw new EfsSoapError("InvalidClientId", "session_expired");
        return session.clientId;
      },
      { fetchImpl: rec.fetchImpl },
    );

    expect(result).toBe("new");
    expect(seen).toEqual(["old", "new"]);
    expect(rec.count("login")).toBe(2);
  });

  it("gives up after a SECOND session_expired instead of looping", async () => {
    const rec = recorder([loginOk("a"), loginOk("b"), loginOk("c")]);

    await expect(
      withEfsSession(env, creds, "interactive", async () => {
        throw new EfsSoapError("InvalidClientId", "session_expired");
      }, { fetchImpl: rec.fetchImpl }),
    ).rejects.toMatchObject({ code: "session_expired" });

    // One initial login plus exactly one refresh. A third would be the start of a loop.
    expect(rec.count("login")).toBe(2);
  });

  it("never lets a cached session outlive EFS's ~03:00 CT reset", async () => {
    // 02:40 America/Chicago (CDT, UTC-5) — twenty minutes before the vendor drops the token, so the
    // 20-minute TTL would otherwise carry the session five minutes past it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T07:40:00Z"));
    const rec = recorder([loginOk()]);
    await withEfsSession(env, creds, "live", async () => 1, { fetchImpl: rec.fetchImpl });

    const expiresAt = efsSessionDiagnostics(creds).expiresAt;
    expect(expiresAt).toBe("2026-08-11T07:55:00.000Z"); // 02:55 CDT, not 03:00 CT
    vi.useRealTimers();
  });
});

describe("EFS login circuit breaker", () => {
  afterEach(() => {
    __resetEfsSessions();
    __resetSoapPacing();
    vi.restoreAllMocks();
  });

  it("tolerates a single credential fault — one blip must not pause the fuel feed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = recorder([fault("Invalid username or password"), loginOk()]);

    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({ code: "auth" });
    expect(efsSessionDiagnostics(creds).breakerOpenUntil).toBeNull();

    // Still reachable: the breaker did not slam shut on one refusal.
    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).resolves.toMatchObject({ clientId: "session-1" });
  });

  it("opens after three CONSECUTIVE credential faults and then makes zero network calls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = recorder([fault("Invalid username or password")], fault("Invalid username or password"));

    for (let i = 0; i < 3; i++) {
      await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toBeInstanceOf(EfsSoapError);
    }
    const callsBefore = rec.bodies.length;
    expect(efsSessionDiagnostics(creds).breakerOpenUntil).not.toBeNull();

    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({ code: "account_locked" });
    // The whole point: a locked-out account is not asked again on a timer.
    expect(rec.bodies.length).toBe(callsBefore);
  });

  it("resets the run on success, so an intermittent failure never accumulates to a trip", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = fault("Invalid username or password");
    const rec = recorder([bad, loginOk(), bad, loginOk(), bad, loginOk()]);

    for (let i = 0; i < 3; i++) {
      await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toBeInstanceOf(EfsSoapError);
      await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).resolves.toBeTruthy();
    }
    expect(efsSessionDiagnostics(creds).breakerOpenUntil).toBeNull();
    expect(efsSessionDiagnostics(creds).consecutiveAuthFailures).toBe(0);
  });

  it("opens IMMEDIATELY on AccountLockedException — the vendor has already locked us", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = recorder([fault("AccountLockedException: too many invalid logins")]);

    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({ code: "account_locked" });
    expect(efsSessionDiagnostics(creds).breakerOpenUntil).not.toBeNull();
  });

  it("is SHARED — an open breaker stops withEfsSession callers too, not just direct logins", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = recorder([], fault("AccountLockedException"));
    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toBeInstanceOf(EfsSoapError);
    const callsBefore = rec.bodies.length;

    // Card control and the feed pollers consult one breaker; that is what stops them racing into a lockout.
    await expect(
      withEfsSession(env, creds, "interactive", async () => 1, { fetchImpl: rec.fetchImpl }),
    ).rejects.toMatchObject({ code: "account_locked" });
    expect(rec.bodies.length).toBe(callsBefore);
  });

  it("does not count transport failures toward the breaker", async () => {
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    for (let i = 0; i < 4; i++) {
      await expect(efsLogin(env, creds, "live", { fetchImpl: boom })).rejects.toMatchObject({ code: "transport" });
    }
    // Pausing every EFS call for half an hour over a flaky socket would be an outage of our own making.
    expect(efsSessionDiagnostics(creds).breakerOpenUntil).toBeNull();
  });

  it("does not RETRY a login fault — EFS returns faults as HTTP 200, so retries never engage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retryingEnv = testEnv({ ...env, EFS_SOAP_MAX_RETRIES: 4 });
    const rec = recorder([], fault("Invalid username or password"));

    await expect(efsLogin(retryingEnv, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({ code: "auth" });
    // Load-bearing, and previously only an accident of the transport: a fault arrives with a 2xx
    // status, so it never enters soapClient's 429/5xx retry branch. Four retries against a bad
    // password is exactly how the account gets locked.
    expect(rec.bodies.length).toBe(1);
  });

  it("never puts the password in the error that reaches an operator", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = recorder([], fault("Invalid username or password"));

    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toSatisfy(
      (e: EfsSoapError) => !JSON.stringify({ m: e.message, d: e.detail }).includes(creds.soapPassword),
    );
  });
});

describe("EFS fault classification", () => {
  afterEach(() => {
    __resetEfsSessions();
    __resetSoapPacing();
    vi.restoreAllMocks();
  });

  it.each([
    ["InvalidClientId", "session_expired"],
    ["Flying J", "soap_fault"],
    ["AccountLockedException", "account_locked"],
    ["InvalidLoginException", "auth"],
    ["InvalidAccountException", "auth"],
    // The guide spells it "NotAllowed"; the live service emits "Not Allowed 109491436176". Both are
    // the same refusal, and both must classify — matching only the documented spelling is what let a
    // real access block reach an operator as an unexplained soap_fault.
    ["NotAllowed", "not_allowed"],
    ["Not Allowed 109491436176", "not_allowed"],
    ["InvalidParameterNameID", "soap_fault"],
    /**
     * The live production faultstring, verbatim, from the account walk on 2026-08-17.
     *
     * ⚠ It classified as `rate_limited` before that date, because the fallback heuristic tests
     * `/rate|limit|429/` and the vendor's FEATURE NAMES contain "Limits". A permanent contract
     * refusal read as throttling, which is how `docs/25` question 6 sat 🟡 "unanswered" while the
     * vendor had answered it in full. The word here is "allow", not "Allowed", so the guide's own
     * NotAllowed pattern above does not catch it.
     */
    [
      "contract for carrier 139445 and policy 1 does not allow Refreshing Limits/Velocity Limits [getPolicyRefreshingLimits]",
      "not_entitled",
    ],
  ])("maps the documented fault %s to code %s", async (faultName, expected) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    __resetEfsSessions();
    const rec = recorder([], fault(faultName));
    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({ code: expected });
  });

it("keeps EFS's own faultstring — and its reference number — in the message", async () => {
    // "Not Allowed 109491436176": the reference is the first thing WEX support asks for, and the job
    // ledger stores `message`, so a friendly message that REPLACES the faultstring loses the only
    // part anybody outside this codebase can act on.
    vi.spyOn(console, "error").mockImplementation(() => {});
    __resetEfsSessions();
    const rec = recorder([], fault("Not Allowed 109491436176"));
    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({
      code: "not_allowed",
    });
    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toThrow(/109491436176/);
  });

  it("reads a fault name out of <detail> when faultstring does not carry it", async () => {
    const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
      `<soap:Fault><faultstring>Request failed</faultstring><detail><reason>InvalidClientId</reason></detail></soap:Fault>` +
      `</soap:Body></soap:Envelope>`;
    const rec = recorder([], body);

    // Misreading this one means we either never refresh a session or hammer the account pointlessly.
    await expect(efsLogin(env, creds, "live", { fetchImpl: rec.fetchImpl })).rejects.toMatchObject({ code: "session_expired" });
  });
});
