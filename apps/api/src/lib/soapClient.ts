import type { Env } from "../env.js";

/**
 * Rate-limited SOAP client factory. Every EFS SOAP call goes through here so ONE place enforces:
 *
 *  - **Per-credential pacing.** Requests-per-second is capped by EFS_SOAP_MAX_RPS. A slot is
 *    reserved before each dispatch so N concurrent callers on one credential are serialized to the
 *    cadence — schedulers, manual "sync now" clicks, and test-connection probes can't collectively
 *    exceed EFS's per-token limit.
 *  - **Two priority lanes.** "live" (rejected polling — the fraud signal) gets a reserved share of
 *    the cap; "backfill" (posted polling / historical fill) gets the remainder. A slow posted
 *    backfill can therefore never starve real-time rejection polling. Mirrors samsaraHttp.ts.
 *  - **Retry with Retry-After + exponential backoff.** 429s honor the Retry-After header;
 *    5xx/network errors back off with jitter, up to EFS_SOAP_MAX_RETRIES.
 *  - **Direct or platform-static egress.** EFS allowlists the Railway static outbound IPv4s; direct
 *    fetch is used by default. The proxy variable remains available for a future dedicated hop.
 *
 * We deliberately model this at the HTTP layer so pacing and retries are testable in isolation.
 * The EFS-specific operations layer (`efsSoap.ts`) owns the WSDL operation bodies and response mapping.
 *
 * NOTHING WSDL-SPECIFIC LIVES HERE. This file has no assumptions about EFS's SOAP operations,
 * response schemas, or field names — it only handles HTTP, auth-header injection, pacing and
 * retries. Every WSDL-dependent decision lives in `efsSoap.ts`.
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

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. Exported for tests. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

// ── SOAP dispatch shape (independent of the `soap` library so it's unit-testable) ──────────────

export type SoapPriority = "live" | "backfill";

export interface SoapRequestOptions {
  /** Full endpoint URL (from `efs_soap_credentials.endpoint_url`). */
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
  /** Injectable fetch — tests pass a stub. */
  fetchImpl?: typeof fetch;
}

export interface SoapResponse {
  status: number;
  headers: Headers;
  body: string;
}

/** Rate limit lane split. Mirrors samsaraHttp.ts's laneRps for consistent tuning across integrations. */
export function soapLaneRps(env: Env, priority: SoapPriority, liveFraction = 0.7): number {
  const live = env.EFS_SOAP_MAX_RPS * liveFraction;
  return Math.max(0.1, priority === "backfill" ? env.EFS_SOAP_MAX_RPS - live : live);
}

/**
 * Send one SOAP request with pacing + retries. The caller owns:
 *   • building the envelope (efsSoap.ts wraps this so operations look normal)
 *   • parsing the response body (envelope + operation-specific unwrap)
 *   • sending the already-authenticated SOAP body supplied by the EFS operation layer
 *
 * This function ONLY does: pace → dispatch → retry-on-transient → return.
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

  const headers: Record<string, string> = {
    "Content-Type": 'text/xml; charset="utf-8"',
    ...(opts.soapAction !== null ? { SOAPAction: opts.soapAction ?? "" } : {}),
    ...(opts.headers ?? {}),
  };

  let attempt = 0;
  for (;;) {
    const wait = reserveSlot(slotKey, rps);
    if (wait > 0) await sleep(wait);
    let res: Response;
    try {
      res = await doFetch(opts.url, { method: "POST", headers, body: opts.body });
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await sleep(backoffMs(attempt++));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const ra = parseRetryAfter(res.headers.get("retry-after"));
      await sleep(ra ?? backoffMs(attempt));
      attempt++;
      continue;
    }
    // Read the body once; downstream parses XML regardless of status (SOAP faults are in the body).
    const body = await res.text();
    return { status: res.status, headers: res.headers, body };
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
