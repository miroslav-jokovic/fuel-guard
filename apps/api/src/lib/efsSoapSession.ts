import { createHash } from "node:crypto";
import { nextEfsWallClock } from "@fuelguard/shared";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { buildSoapEnvelope, xmlEscape } from "./efsXml.js";
import { EfsSoapError, parseSoap, responseResult } from "./efsSoapFaults.js";

export { EfsSoapError, parseSoap, responseResult, responseValues } from "./efsSoapFaults.js";
import { classifyTlsError, soapFetch, type SoapPriority } from "./soapClient.js";
import { BlockedEndpointError } from "./ssrfGuard.js";

/**
 * EFS `CardManagementWS` session handling and fault classification — everything true of *any*
 * operation on the service, with no knowledge of which operations exist.
 *
 * Split out of `efsSoap.ts` (which kept only the two transaction feeds) because card control needs
 * the same session, the same faults and the same request plumbing, and `efsSoap.ts` was at its
 * 500-line budget. `efsSoap.ts` re-exports what its old importers used, so nothing else changed.
 *
 * ── Why sessions are cached ──────────────────────────────────────────────────────────────────────
 * EFS authenticates with `login(user,password)` → a `clientId` passed as the first field of every
 * call (guide p118). Logging in per operation was fine when the only callers were two pollers on a
 * timer. It stops being fine the moment a human can click "Lock card": N concurrent clicks become N
 * logins, and the guide documents `AccountLockedException` for "too many invalid logins" (p118).
 *
 * That account is SHARED with transaction ingestion. Locking it out does not merely degrade card
 * control — it stops the fuel feed. So, in order of importance:
 *
 *   1. **One breaker, shared by every caller.** Card control and both feed schedulers consult the
 *      same one. A bad credential stops everything loudly and immediately, instead of three callers
 *      racing each other into a lockout.
 *   2. **Single-flight login.** Ten concurrent operations produce one login, not ten.
 *   3. **Proactive expiry.** The guide says the clientId dies daily around 03:00 CT (p11). We expire
 *      at 02:55 CT — or after 20 minutes, whichever is sooner — so we rarely *discover* that the hard
 *      way, and the single re-login below stays a safety net rather than the normal path.
 *
 * State is per-process and in-memory. Two API replicas hold two sessions, which is correct: a session
 * is a vendor-side token, not a lock, and both are paced through the same per-credential limiter in
 * `soapClient.ts`.
 */

// ─── One request ───────────────────────────────────────────────────────────────────────────────

export interface EfsRequestOptions {
  /** Injectable fetch — tests pass a stub. */
  fetchImpl?: typeof fetch;
  /** `false` disables retries. MANDATORY for state-mutating operations: a timed-out write may have
   *  landed, so retrying it is a second write. Reconcile by re-read instead. */
  retry?: boolean;
  /** Session cookie to carry (JSESSIONID). See the cookie-jar note on `EfsSession`. */
  cookie?: string | null;
  /** Per-request deadline. Omitted → the lane default from `laneTimeoutMs`. */
  timeoutMs?: number;
  /** Optional caller-owned deadline spanning multiple SOAP operations. */
  signal?: AbortSignal;
}

export async function requestXml(
  env: Env,
  creds: EfsSoapCredentials,
  operation: string,
  body: string,
  priority: SoapPriority,
  opts: EfsRequestOptions = {},
): Promise<{ body: string; headers: Headers }> {
  try {
    const response = await soapFetch(env, `${creds.orgId}:${creds.endpointUrl}`, {
      url: creds.endpointUrl,
      body: buildSoapEnvelope({ operationBody: body }),
      soapAction: operation,
      headers: opts.cookie ? { Cookie: opts.cookie } : undefined,
      priority,
      // Per-org client certificate resolved by getEfsSoapCredentials; undefined means "fall back to
      // the deploy-wide env material", which is what a single-tenant install uses.
      tls: creds.tls,
      fetchImpl: opts.fetchImpl,
      retry: opts.retry,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new EfsSoapError(`EFS rejected the ${operation} request`, "auth", response.status);
    }
    // EFS may return a SOAP Fault with HTTP 500. Parse the body before classifying the status so the
    // caller receives the documented fault code/message instead of an opaque transport error.
    try {
      parseSoap(response.body);
    } catch (fault) {
      // A fault carries no hint of which call produced it. Without the operation name, "Not Allowed"
      // cannot distinguish a blocked egress address (everything fails) from an unentitled operation
      // (only this one does) — and those have completely different remedies.
      if (fault instanceof EfsSoapError) {
        throw new EfsSoapError(`${fault.message} [${operation}]`, fault.code, fault.detail);
      }
      throw fault;
    }
    if (response.status === 429) {
      throw new EfsSoapError(`EFS rate-limited the ${operation} request`, "rate_limited", response.status);
    }
    if (response.status >= 400) {
      throw new EfsSoapError(`EFS returned HTTP ${response.status} for ${operation}`, "transport", response.status);
    }
    return { body: response.body, headers: response.headers };
  } catch (error) {
    if (error instanceof EfsSoapError) throw error;
    // A refused endpoint (lib/ssrfGuard.ts, audit 2026-08-09 §3.8) is a CONFIGURATION answer, not a
    // network or TLS symptom — classifyTlsError below would only guess at it. Carry the guard's
    // caller-safe message through so the settings page says something an admin can act on, and keep
    // only the reason code as detail: the guard's `detail` names internal addresses and must not
    // travel any further than the log line that already printed it.
    if (error instanceof BlockedEndpointError) {
      throw new EfsSoapError(error.message, "blocked_endpoint", { reason: error.reason });
    }
    // A handshake failure is the single most likely mTLS symptom and the least self-explanatory, so
    // it never reaches the operator as a bare "transport" error. classifyTlsError turns an OpenSSL
    // alert code into the action that fixes it.
    const tlsFailure = classifyTlsError(error);
    if (tlsFailure.kind !== "unknown") {
      throw new EfsSoapError(
        `EFS ${operation} failed at the TLS layer: ${tlsFailure.message}`,
        tlsFailure.kind === "network" ? "transport" : "tls",
        { code: tlsFailure.code, kind: tlsFailure.kind },
      );
    }
    throw new EfsSoapError(`EFS ${operation} request failed`, "transport", error);
  }
}

// ─── Session state ─────────────────────────────────────────────────────────────────────────────

export interface EfsSession {
  clientId: string;
  /**
   * The JSESSIONID captured at login, replayed on every request in this session. The guide requires
   * per-session cookie jars (RFC 6265, p10) and warns that network appliances may block ALL sessions
   * if they cannot isolate an abusive one. Keeping the cookie on the session object — keyed by org —
   * IS that jar. The keep-alive HTTPS agent pool in efsTls.ts is keyed by TLS identity, so two orgs
   * may share a socket; that is connection reuse, not session sharing, because Cookie is a
   * per-request header.
   */
  cookie: string | null;
  expiresAt: number;
}

const SESSION_OPS = { login: "login", logout: "logout" } as const;
// Step 5.9: the session-lifetime and breaker fallbacks used to live here as literals behind
// `env.X ?? …`. Both keys carry a zod `.default()` (env.ts), so the fallbacks were unreachable and
// only ever a second place for the number to disagree with the first. `EFS_SOAP_SESSION_TTL_MS`
// (20m, well under EFS's daily reset) and `EFS_LOGIN_BREAKER_MS` (30m) are the single source now.
/** EFS expires clientIds "around 3:00 AM CT" (p11). Stop five minutes short of the stated boundary. */
const CT_RESET_HOUR = 2;
const CT_RESET_MINUTE = 55;

/**
 * Consecutive credential failures before the breaker opens.
 *
 * Not one. EFS locks the account after "too many invalid logins", not after one, and a single
 * `auth`-classified fault can be a vendor blip or a heuristic misread of an unfamiliar faultstring —
 * pausing every EFS call for half an hour over that would be an outage of our own making. Three
 * consecutive refusals is a real verdict; one is noise. An explicit `AccountLockedException` skips
 * the counter entirely, because at that point the vendor has already locked us and asking again is
 * pure harm.
 */
const LOGIN_FAILURE_THRESHOLD = 3;

const sessions = new Map<string, EfsSession>();
const inFlightLogins = new Map<string, Promise<EfsSession>>();
const breakers = new Map<string, { openUntil: number; reason: string }>();
const consecutiveAuthFailures = new Map<string, number>();

const sessionKey = (creds: EfsSoapCredentials): string => {
  const credentialHash = createHash("sha256")
    .update(`${creds.soapPassword}\u0000${creds.tls?.fingerprintSha256 ?? "none"}`)
    .digest("hex")
    .slice(0, 16);
  return `${creds.orgId}:${creds.endpointUrl}:${credentialHash}`;
};

/** Test seam. Also call on credential change, so a rotated password cannot ride a cached session. */
export function __resetEfsSessions(orgId?: string): void {
  if (!orgId) {
    sessions.clear();
    inFlightLogins.clear();
    breakers.clear();
    consecutiveAuthFailures.clear();
    return;
  }
  const prefix = `${orgId}:`;
  for (const cache of [sessions, inFlightLogins, breakers, consecutiveAuthFailures]) {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  }
}

/** Non-secret view for the settings page and logs. Never exposes the clientId or the cookie. */
export function efsSessionDiagnostics(creds: EfsSoapCredentials): {
  hasSession: boolean;
  expiresAt: string | null;
  breakerOpenUntil: string | null;
  breakerReason: string | null;
  consecutiveAuthFailures: number;
} {
  const key = sessionKey(creds);
  const session = sessions.get(key);
  const breaker = breakers.get(key);
  const open = breaker && breaker.openUntil > Date.now() ? breaker : null;
  return {
    hasSession: !!session && session.expiresAt > Date.now(),
    expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    breakerOpenUntil: open ? new Date(open.openUntil).toISOString() : null,
    breakerReason: open?.reason ?? null,
    consecutiveAuthFailures: consecutiveAuthFailures.get(key) ?? 0,
  };
}

function assertBreakerClosed(key: string): void {
  const breaker = breakers.get(key);
  if (!breaker) return;
  if (breaker.openUntil <= Date.now()) {
    breakers.delete(key);
    return;
  }
  // No network call. The entire point is that a locked-out account is not asked again on a timer.
  throw new EfsSoapError(
    `EFS logins are paused until ${new Date(breaker.openUntil).toISOString()}: ${breaker.reason}`,
    "account_locked",
    { openUntil: breaker.openUntil },
  );
}

/** Record a login outcome and open the breaker when the account has clearly stopped accepting us. */
function recordLoginFailure(env: Env, key: string, error: EfsSoapError): void {
  const locked = error.code === "account_locked";
  const failures = locked ? LOGIN_FAILURE_THRESHOLD : (consecutiveAuthFailures.get(key) ?? 0) + 1;
  consecutiveAuthFailures.set(key, failures);
  if (failures < LOGIN_FAILURE_THRESHOLD) return;
  const ms = env.EFS_LOGIN_BREAKER_MS;
  breakers.set(key, { openUntil: Date.now() + ms, reason: error.message });
  sessions.delete(key);
  // Loud on purpose: this also stops transaction ingestion, and nobody should have to infer that from
  // a quiet feed. routes/integrations.ts surfaces it on the settings page via efsSessionDiagnostics.
  console.error(`[efs-soap] login breaker OPEN for ${ms}ms (org ${key.split(":")[0]}): ${error.code} — ${error.message}`);
}

function sessionExpiry(env: Env, now: Date): number {
  const ttl = env.EFS_SOAP_SESSION_TTL_MS;
  return Math.min(now.getTime() + ttl, nextEfsWallClock(now, CT_RESET_HOUR, CT_RESET_MINUTE));
}

// ─── Login / logout ────────────────────────────────────────────────────────────────────────────

function cookieHeader(headers: Headers): string | null {
  const raw = headers.get("set-cookie");
  if (!raw) return null;
  return raw
    .split(/,(?=[^;,]+=)/)
    .map((part) => part.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ") || null;
}

/** One login round trip. Prefer `withEfsSession`; this is exported for `pingEfsSoap`, which has to
 *  PROVE a fresh login works and so may not answer from a cached one. */
export async function efsLogin(
  env: Env,
  creds: EfsSoapCredentials,
  priority: SoapPriority,
  opts: EfsRequestOptions = {},
): Promise<EfsSession> {
  const key = sessionKey(creds);
  assertBreakerClosed(key);
  const body = `<CardManagementEP_login><user>${xmlEscape(creds.soapUsername)}</user><password>${xmlEscape(creds.soapPassword)}</password></CardManagementEP_login>`;
  try {
    // retry:false BY DEFAULT (audit P1-1). With the transport's 4-retry default, one wrong password
    // became ~5 vendor-side invalid logins per attempt — and the breaker's threshold of 3 attempts
    // admitted ~15 before opening, actively feeding the AccountLockedException it exists to prevent,
    // on the shared account that also runs transaction ingestion. A failed login is re-attempted by
    // the CALLER's next operation, at the caller's pace; the transport must not multiply it.
    const response = await requestXml(env, creds, SESSION_OPS.login, body, priority, { retry: false, ...opts });
    const session = {
      clientId: responseResult(response.body),
      cookie: cookieHeader(response.headers),
      expiresAt: sessionExpiry(env, new Date()),
    };
    // A success clears the run. "Consecutive" is what makes the threshold mean anything: a password
    // that works every other time is a vendor problem, not a locked account.
    consecutiveAuthFailures.delete(key);
    return session;
  } catch (error) {
    // ONLY a credential verdict counts toward the breaker. A timeout or a TLS failure is a transport
    // problem; pausing logins for half an hour over a flaky socket would be an outage of our own making.
    if (error instanceof EfsSoapError && (error.code === "auth" || error.code === "account_locked")) {
      recordLoginFailure(env, key, error);
    }
    throw error;
  }
}

export async function efsLogout(
  env: Env,
  creds: EfsSoapCredentials,
  session: EfsSession,
  priority: SoapPriority,
  opts: EfsRequestOptions = {},
): Promise<void> {
  try {
    await requestXml(
      env, creds, SESSION_OPS.logout,
      `<CardManagementEP_logout><clientId>${xmlEscape(session.clientId)}</clientId></CardManagementEP_logout>`,
      priority,
      { ...opts, retry: false, cookie: session.cookie },
    );
  } catch {
    // Session cleanup is best effort; never hide a successful data response behind logout failure.
  }
}

/**
 * Run `fn` against a live EFS session, reusing a cached one where possible.
 *
 * Concurrency: the first caller for an org starts a login and parks its promise; every other caller
 * awaits that same promise. Ten simultaneous "lock card" clicks cost one login.
 *
 * Expiry: exactly ONE re-login is attempted when EFS answers `InvalidClientId`. A second such fault
 * throws. There is no loop here by design — the guide's own advice is "don't use infinite loops for
 * retries" (p11), and a login loop is the shortest path to `AccountLockedException`.
 */
export async function withEfsSession<T>(
  env: Env,
  creds: EfsSoapCredentials,
  priority: SoapPriority,
  fn: (session: EfsSession) => Promise<T>,
  opts: EfsRequestOptions = {},
): Promise<T> {
  const key = sessionKey(creds);
  assertBreakerClosed(key);
  try {
    return await fn(await acquire(env, creds, priority, key, opts));
  } catch (error) {
    if (!(error instanceof EfsSoapError) || error.code !== "session_expired") throw error;
    sessions.delete(key);
    // If this one expires too, something other than the daily reset is wrong. Let it surface.
    return await fn(await acquire(env, creds, priority, key, opts));
  }
}

async function acquire(
  env: Env,
  creds: EfsSoapCredentials,
  priority: SoapPriority,
  key: string,
  opts: EfsRequestOptions,
): Promise<EfsSession> {
  const cached = sessions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const pending = inFlightLogins.get(key);
  if (pending) return pending;
  const attempt = efsLogin(env, creds, priority, opts)
    .then((session) => {
      sessions.set(key, session);
      return session;
    })
    .finally(() => {
      inFlightLogins.delete(key);
    });
  inFlightLogins.set(key, attempt);
  return attempt;
}
