import { request as httpsRequest } from "node:https";
import type { Env } from "../env.js";
import { agentFor, assertTlsPolicy, envTlsMaterial, type EfsTlsMaterial } from "./efsTls.js";
import { BlockedEndpointError, allowPrivateEndpoints, assertOutboundUrlAllowed } from "./ssrfGuard.js";

// Mutual TLS — material resolution, connection pooling and handshake-error classification — lives in
// efsTls.js. Re-exported here so every existing importer of soapClient.js keeps working unchanged.
export {
  assertTlsPolicy,
  classifyTlsError,
  describeEfsTls,
  describeTlsMaterial,
  efsTlsOptions,
  envTlsMaterial,
  invalidateTlsAgents,
  type EfsTlsMaterial,
  type TlsFailure,
  type TlsFailureKind,
} from "./efsTls.js";

/**
 * Rate-limited SOAP client factory. Every EFS SOAP call goes through here so ONE place enforces:
 *
 *  - **Per-credential pacing.** Requests-per-second is capped by EFS_SOAP_MAX_RPS. A slot is
 *    reserved before each dispatch so N concurrent callers on one credential are serialized to the
 *    cadence — schedulers, manual "sync now" clicks, and test-connection probes can't collectively
 *    exceed EFS's per-token limit.
 *  - **Three priority lanes.** "live" (rejected polling — the fraud signal) gets a reserved share of
 *    the cap; "backfill" (posted polling / historical fill) gets the remainder. A slow posted
 *    backfill can therefore never starve real-time rejection polling. Mirrors samsaraHttp.ts.
 *    "interactive" (card control, a human waiting) carries its OWN budget outside that split — see
 *    soapLaneRps().
 *  - **Retry with Retry-After + exponential backoff.** 429s honor the Retry-After header;
 *    5xx/network errors back off with jitter, up to EFS_SOAP_MAX_RETRIES.
 *  - **Per-request timeouts.** Both dispatch branches carry a deadline (fetch via AbortSignal,
 *    node:https via req.setTimeout). Neither did before; a half-open socket hung indefinitely.
 *    Timeouts are transient and retry — EXCEPT under `retry: false`, which is mandatory for any call
 *    that mutates vendor state, because a timed-out write may have landed.
 *  - **Direct or platform-static egress.** EFS allowlists the Railway static outbound IPv4s; direct
 *    fetch is used by default. The proxy variable remains available for a future dedicated hop.
 *  - **Egress safety (SSRF).** The endpoint URL is tenant-supplied, so every dispatch is re-validated
 *    against lib/ssrfGuard.ts first — https only, no embedded credentials, and no host that resolves
 *    into loopback/link-local/private space. Redirects are refused rather than followed. See the gate
 *    inside soapFetch() and security audit 2026-08-09 finding 3.8.
 *  - **Mutual TLS.** When a client certificate is configured — per-org (`efs_soap_client_certs`) or
 *    deploy-wide (`EFS_SOAP_CLIENT_*`) — requests go over `node:https` with that material, through a
 *    keep-alive agent pooled by certificate identity, with a TLS 1.2 floor and classified handshake
 *    errors. Unconfigured — the default — plain `fetch` is used and nothing changes. The material,
 *    the pool and the error classifier now live in `efsTls.ts` and are re-exported above.
 *
 * We deliberately model this at the HTTP layer so pacing and retries are testable in isolation.
 * The EFS-specific operations layer owns the WSDL operation bodies and response mapping:
 * `efsSoapSession.ts` (session + XML), `efsSoap.ts` (transaction feeds), `efsCardOps.ts` (card control).
 *
 * NOTHING WSDL-SPECIFIC LIVES HERE. This file has no assumptions about EFS's SOAP operations,
 * response schemas, or field names — it only handles HTTP, auth-header injection, pacing and
 * retries. Every WSDL-dependent decision lives in the operations layer.
 */

// ── Rate limiting (borrowed shape from samsaraHttp.ts) ──────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-(credential, lane) pacing: `nextFreeAt[key]` is the earliest wall-clock time the next request
// may start. Each call reserves the following slot, so N concurrent callers on one credential are
// serialized to the cadence.
const nextFreeAt = new Map<string, number>();

function reserveSlot(slotKey: string, rps: number): number {
  const interval = 1000 / Math.max(0.1, rps);
  const now = Date.now();
  const start = Math.max(now, nextFreeAt.get(slotKey) ?? 0);
  nextFreeAt.set(slotKey, start + interval);
  return start - now;
}

/** Exponential backoff with full jitter, capped. `attempt` is 0-based. Exported for tests. */
export function backoffMs(attempt: number, baseMs = 500, capMs = 15_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/**
 * Ceiling on any single retry sleep. backoffMs already caps itself at 15s; a vendor (or middlebox)
 * Retry-After header used to be honored UNCAPPED, so `Retry-After: 3600` parked an interactive
 * request handler for an hour (audit P1-1 companion finding). The header is advice; the cap is ours.
 */
export const RETRY_SLEEP_CAP_MS = 15_000;

export const capRetrySleep = (ms: number | null): number | null =>
  ms === null ? null : Math.min(ms, RETRY_SLEEP_CAP_MS);

/**
 * Does this body carry a SOAP Fault? Axis2 delivers APPLICATION faults over HTTP 500 (SOAP 1.1
 * norm), and EFS's own error doctrine (guide p9–10) classifies its named faults — Not Allowed,
 * InvalidParameterNameID — as fix-and-resend or call-your-account-manager, never retry. Before this
 * check, every refused interactive call burned the full retry budget with backoff sleeps in a
 * 1 rps lane: the observed 15–20s card-detail loads were five paced attempts at a permanent answer.
 * A fault body is therefore returned IMMEDIATELY for classification; only fault-less 5xx (a
 * gateway blip, a genuine server error) stays retryable. Cheap string probe on purpose — the real
 * parse happens downstream in parseSoap; this only has to be sound, and a false negative merely
 * retries like before.
 */
export const looksLikeSoapFault = (body: string): boolean => /<(\w+:)?Fault[\s>]/.test(body);

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. Exported for tests. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

// ── SOAP dispatch shape (independent of the `soap` library so it's unit-testable) ──────────────

/** POST over node:https with the configured client certificate. Same result shape as fetch.
 *
 *  `timeoutMs` covers socket inactivity, not total wall time — that is what node:https gives us, and
 *  it is the failure we actually see: a half-open socket to a vendor that has stopped answering. The
 *  destroy() surfaces as an ordinary request error, so it lands in soapFetch's transient-retry catch
 *  alongside ECONNRESET rather than needing its own branch. */
function httpsPost(url: string, headers: Record<string, string>, body: string, tls: EfsTlsMaterial, timeoutMs?: number, signal?: AbortSignal): Promise<SoapResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpsRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        agent: agentFor(tls),
        servername: target.hostname, // explicit SNI — some endpoints route on it
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue;
            // set-cookie arrives as an array; cookieHeader() in efsSoapSession.ts re-splits a joined value.
            out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
          }
          resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (signal) {
      const abort = () => req.destroy(Object.assign(new Error("EFS request aborted"), { code: "ABORT_ERR" }));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      req.once("close", () => signal.removeEventListener("abort", abort));
    }
    if (timeoutMs && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        // Mirror the shape of a real socket timeout so classifyTlsError() reads it as "network".
        req.destroy(Object.assign(new Error("EFS request timed out"), { code: "ETIMEDOUT" }));
      });
    }
    req.write(body);
    req.end();
  });
}

/**
 * Priority lanes.
 *
 *  - `live`        — the rejected-transaction poller: the fraud signal, must not queue behind bulk work.
 *  - `backfill`    — the posted-transaction poller and historical catch-up.
 *  - `interactive` — a human is watching (card control). Gets its OWN budget rather than a third slice
 *    of EFS_SOAP_MAX_RPS, because re-splitting would silently slow both existing pollers the day card
 *    control ships. The cost of that choice is that total offered load becomes
 *    EFS_SOAP_MAX_RPS + EFS_SOAP_INTERACTIVE_RPS — see the note in env.ts.
 */
export type SoapPriority = "live" | "backfill" | "interactive";

export interface SoapRequestOptions {
  /** Full endpoint URL (from `efs_soap_credentials.endpoint_url`). TENANT-SUPPLIED — re-validated by
   *  the SSRF gate in soapFetch() on every call, never trusted because it was checked when stored. */
  url: string;
  /** Complete SOAP envelope body (XML string). */
  body: string;
  /** Headers to send. `Content-Type` and `SOAPAction` are set here if omitted. */
  headers?: Record<string, string>;
  /** Optional SOAPAction — some SOAP servers require it, some don't. Set to null to omit. */
  soapAction?: string | null;
  /** Priority lane. See laneRps(). */
  priority?: SoapPriority;
  /** Retry policy. `retry: false` disables retries entirely (use for test-connection probes). */
  retry?: boolean;
  /**
   * Resolved TLS material for THIS request. Passed in rather than resolved here because the per-org
   * certificate lives in the database and unsealing it is the credentials layer's job — this file
   * stays synchronous and DB-free. `undefined` falls back to the deploy-wide env material; explicit
   * `null` forces ordinary TLS (used by the tests).
   */
  tls?: EfsTlsMaterial | null;
  /** Injectable fetch — tests pass a stub. */
  fetchImpl?: typeof fetch;
  /**
   * Per-request timeout in ms. Omitted → resolved from the lane (see `laneTimeoutMs`). Explicit `0`
   * disables it. A timeout is a TRANSIENT: it retries like a 5xx, EXCEPT under `retry: false`.
   *
   * ⚠ Callers that mutate vendor state (setCardV2) must pass `retry: false`. A timed-out write may
   * have LANDED; retrying it is a second write. Reconcile by re-read instead — see
   * services/efsCardControl.ts.
   */
  timeoutMs?: number;
  /** Optional caller-owned deadline shared by a multi-request orchestration. */
  signal?: AbortSignal;
}

export interface SoapResponse {
  status: number;
  headers: Headers;
  body: string;
}

/** Rate limit lane split. Mirrors samsaraHttp.ts's laneRps for consistent tuning across integrations.
 *
 *  `interactive` returns early and deliberately does NOT participate in the live/backfill split: the
 *  two poller lanes keep exactly the budget they had before card control existed. */
export function soapLaneRps(env: Env, priority: SoapPriority, liveFraction = 0.7): number {
  if (priority === "interactive") return Math.max(0.1, env.EFS_SOAP_INTERACTIVE_RPS ?? 1);
  const live = env.EFS_SOAP_MAX_RPS * liveFraction;
  return Math.max(0.1, priority === "backfill" ? env.EFS_SOAP_MAX_RPS - live : live);
}

/** Default request timeout for a lane. A human waiting on a card lock gets a tighter deadline than a
 *  backfill page that nobody is watching. `?? ` rather than a bare read so a partial Env (tests, or a
 *  deploy predating these keys) degrades to the documented default instead of `NaN`. */
export function laneTimeoutMs(env: Env, priority: SoapPriority): number {
  return priority === "interactive"
    ? (env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS ?? 10_000)
    : (env.EFS_SOAP_TIMEOUT_MS ?? 20_000);
}

/**
 * Send one SOAP request with pacing + retries. The caller owns:
 *   • building the envelope (efsSoap.ts wraps this so operations look normal)
 *   • parsing the response body (envelope + operation-specific unwrap)
 *   • sending the already-authenticated SOAP body supplied by the EFS operation layer
 *
 * This function ONLY does: validate-target → pace → dispatch → retry-on-transient → return.
 *
 * Egress proxying is intentionally not enabled in this client yet; Railway's static outbound IPs are
 * the production path. If a dedicated proxy is introduced, it should be wired here without changing
 * the EFS operation layer.
 */
export async function soapFetch(
  env: Env,
  credentialKey: string,
  opts: SoapRequestOptions,
): Promise<SoapResponse> {
  const priority = opts.priority ?? "live";
  const rps = soapLaneRps(env, priority);
  const slotKey = `${credentialKey}:${priority}`;
  const maxRetries = opts.retry === false ? 0 : env.EFS_SOAP_MAX_RETRIES;
  const doFetch = opts.fetchImpl ?? fetch;
  // Explicit 0 disables the deadline; undefined takes the lane default. Before this existed neither
  // branch set any timeout at all, so a half-open socket hung until the process died.
  const timeoutMs = opts.timeoutMs === undefined ? laneTimeoutMs(env, priority) : opts.timeoutMs;
  const requestSignal = opts.signal
    ? timeoutMs > 0 ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : opts.signal
    : timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  // Precedence: explicit material (per-org, resolved by the credentials layer) → deploy-wide env →
  // none. An injected fetch (tests) that did NOT ask for TLS bypasses the https path entirely, so the
  // mTLS layer can never interfere with the existing suite.
  const tls =
    opts.tls === null ? null : (opts.tls ?? (opts.fetchImpl ? null : envTlsMaterial(env)));
  if (tls) assertTlsPolicy(env, tls);

  // ── SSRF gate (security audit 2026-08-09, finding 3.8) ────────────────────────────────────────
  // `opts.url` originates from an ORG ADMIN typing into the EFS settings page, and the poller dials it
  // from inside the Railway network every few minutes. routes/integrations.ts validates it at write
  // time; this check is NOT redundant with that one. A stored endpoint can predate the write-time
  // check, arrive from the EFS_SOAP_ENDPOINT_URL env fallback, be edited straight in the database, or
  // simply be a name whose DNS answer changed after it was accepted. This is the last thing that runs
  // before a socket is opened, so this is the check that has to hold.
  //
  // Validated once per soapFetch call rather than once per retry: retries reuse the same target within
  // a few seconds, and re-resolving on each one buys a narrower TOCTOU window than the one already
  // inherent in "we resolve, then Node resolves again to connect" (documented in ssrfGuard.ts).
  const targetUrl = await assertOutboundUrlAllowed(opts.url, {
    allowPrivateAddresses: allowPrivateEndpoints(env),
  });

  const headers: Record<string, string> = {
    "Content-Type": 'text/xml; charset="utf-8"',
    ...(opts.soapAction !== null ? { SOAPAction: opts.soapAction ?? "" } : {}),
    ...(opts.headers ?? {}),
  };

  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new Error("EFS request aborted by caller");
    const wait = reserveSlot(slotKey, rps);
    if (wait > 0) await sleep(wait);
    let out: SoapResponse;
    try {
      if (tls) {
        // node:https does not follow redirects at all — a 3xx comes back to the caller as-is, and
        // efsSoap.ts then fails to parse it as SOAP. That is the behaviour we want, and it is why the
        // fetch branch below is made to match it.
        out = await httpsPost(targetUrl, headers, opts.body, tls, timeoutMs, requestSignal);
      } else {
        // `redirect: "manual"` is load-bearing, not a style preference. fetch DEFAULTS to following
        // redirects, and it follows them itself: the URL validated above gets checked, the hop it is
        // sent to next does not. That makes any open redirector a complete bypass of the gate
        // (`https://public.example.com/r?to=http://169.254.169.254/`). We refuse rather than
        // follow-and-recheck each hop, for two reasons: the mTLS path above has never followed
        // redirects, so an endpoint that requires one is already broken for every mTLS deployment;
        // and re-POSTing the SOAP envelope — which carries the org's EFS username and password — to
        // whatever host a redirect names is not worth doing for a fixed, EFS-issued URL.
        // A stubbed fetchImpl in the existing suite ignores `signal`, so attaching one is inert there
        // and the whole suite keeps passing unmodified.
        const res = await doFetch(targetUrl, {
          method: "POST",
          headers,
          body: opts.body,
          redirect: "manual",
          ...(requestSignal ? { signal: requestSignal } : {}),
        });
        if (res.status >= 300 && res.status < 400) {
          throw new BlockedEndpointError(
            "redirect",
            "The EFS endpoint redirected the request. Configure the final endpoint URL that EFS issued.",
            // The Location goes in the LOG-ONLY detail. A public host can redirect to an internal one,
            // so echoing the target back to the admin who supplied the URL would hand them precisely
            // the internal-network oracle that finding 3.8 is about.
            `endpoint answered HTTP ${res.status} redirect to ${res.headers.get("location") ?? "(no Location header)"}`,
          );
        }
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          // The body must be read before the retry decision: a fault-on-500 is the vendor's final
          // answer, not a transient condition — see looksLikeSoapFault. 429 carries no fault.
          const body = await res.text();
          if (res.status >= 500 && looksLikeSoapFault(body)) {
            return { status: res.status, headers: res.headers, body };
          }
          const ra = capRetrySleep(parseRetryAfter(res.headers.get("retry-after")));
          await sleep(ra ?? backoffMs(attempt));
          attempt++;
          continue;
        }
        // Read the body once; downstream parses XML regardless of status (faults are in the body).
        return { status: res.status, headers: res.headers, body: await res.text() };
      }
    } catch (e) {
      // A refused endpoint is a decision, not a transient failure: retrying re-runs the same checks,
      // reaches the same answer, and burns another paced slot on a request we are never going to make.
      if (e instanceof BlockedEndpointError || opts.signal?.aborted) throw e;
      if (attempt >= maxRetries) throw e;
      await sleep(backoffMs(attempt++));
      continue;
    }
    if ((out.status === 429 || out.status >= 500) && attempt < maxRetries) {
      if (out.status >= 500 && looksLikeSoapFault(out.body)) return out; // see looksLikeSoapFault
      const ra = capRetrySleep(parseRetryAfter(out.headers.get("retry-after")));
      await sleep(ra ?? backoffMs(attempt));
      attempt++;
      continue;
    }
    return out;
  }
}

/** Test helper — clears per-credential pacing state so tests don't leak reserved slots. */
export function __resetSoapPacing(): void {
  nextFreeAt.clear();
}

// ── Legacy WS-Security helper ───────────────────────────────────────────────────────────────────
//
// Kept for compatibility with the initial integration seam. The EFS CardManagementWS contract uses
// login(user,password) and a returned clientId, so the active EFS client does not call this helper.

export interface WsSecurityUsernameToken {
  username: string;
  password: string;
  /** 'PasswordText' (plaintext over TLS) or 'PasswordDigest' (SHA-1 digest with nonce+timestamp).
   *  EFS's convention TBD; default 'PasswordText' is the more common enterprise choice. */
  passwordType?: "PasswordText" | "PasswordDigest";
}

/**
 * Build a WS-Security UsernameToken SOAP header block. Returned as an XML string that the caller
 * splices into the SOAP envelope's <soap:Header>. If EFS's actual auth turns out to be different,
 * this function is replaced (or bypassed) — no other file needs to change.
 *
 * Note: PasswordDigest support requires a SHA-1 nonce + timestamp computation. Left as a TODO
 * because (a) EFS probably uses PasswordText, and (b) if they don't, the `soap` library's built-in
 * WSSecurity class handles the digest computation correctly — we'd delegate to it rather than
 * hand-roll it here.
 */
export function buildWsSecurityUsernameTokenHeader(token: WsSecurityUsernameToken): string {
  if ((token.passwordType ?? "PasswordText") !== "PasswordText") {
    throw new Error(
      "PasswordDigest not implemented — delegate to soap library's WSSecurity class instead",
    );
  }
  // Minimal, spec-compliant UsernameToken. No nonce/timestamp because we're using PasswordText
  // over TLS (TLS provides transport confidentiality + replay protection for the connection).
  return (
    `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" soap:mustUnderstand="1">` +
    `<wsse:UsernameToken>` +
    `<wsse:Username>${escapeXml(token.username)}</wsse:Username>` +
    `<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(token.password)}</wsse:Password>` +
    `</wsse:UsernameToken>` +
    `</wsse:Security>`
  );
}

/** Minimal XML escape — enough for SOAP header values. */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
