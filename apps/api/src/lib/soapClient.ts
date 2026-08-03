import { createHash, X509Certificate } from "node:crypto";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
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
 *  - **Mutual TLS.** When a client certificate is configured — per-org (`efs_soap_client_certs`) or
 *    deploy-wide (`EFS_SOAP_CLIENT_*`) — requests go over `node:https` with that material, through a
 *    keep-alive agent pooled by certificate identity, with a TLS 1.2 floor and classified handshake
 *    errors. Unconfigured — the default — plain `fetch` is used and nothing changes.
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

// ── Mutual TLS (client certificate) ─────────────────────────────────────────────────────────────
//
// EFS's production endpoint may require a client certificate. The material can come from two places,
// in this order of precedence:
//
//   1. PER-ORG — the `active` row in `efs_soap_client_certs` (migration 0106), private key sealed at
//      rest. Resolved by services/efsSoapClientCerts.ts and threaded in on the credentials object.
//   2. DEPLOY-WIDE — the EFS_SOAP_CLIENT_* env vars. A single-tenant fallback, and the escape hatch
//      when the database is unavailable or SECRETS_ENCRYPTION_KEY isn't configured yet.
//
// With neither, `tls` is null, requests go over ordinary TLS via `fetch`, and behaviour is exactly
// what it was before this capability existed. That matters: it lets the code ship and be reviewed
// BEFORE EFS confirms whether they require mTLS, with no risk to the working non-mTLS path.
//
// Implemented on `node:https` rather than a fetch dispatcher deliberately. `node:https` accepts
// cert/key/ca/pfx natively, so mutual TLS costs this project zero new runtime dependencies — which
// is the right trade for code that handles a private key.

/** Lowest TLS version we will negotiate. Below 1.2 is not acceptable for a financial integration. */
const MIN_TLS_VERSION = "TLSv1.2" as const;

/**
 * Resolved TLS material for one request, plus the provenance and identity needed to pool connections,
 * attribute handshake outcomes to a stored certificate, and log without leaking anything.
 *
 * `key`/`passphrase` are the only secret fields. Nothing here is ever serialised into a response —
 * `describeTlsMaterial()` is what the API and the logs are allowed to see.
 */
export interface EfsTlsMaterial {
  /** Where it came from — decides whether a handshake result is recorded against a stored row. */
  source: "org" | "env";
  /** `efs_soap_client_certs.id`, when source is "org". */
  certId?: string;
  cert?: string;
  key?: string;
  passphrase?: string;
  ca?: string;
  /** PKCS#12 alternative, for issuers that only hand out a .pfx. */
  pfx?: Buffer;
  /** Lowercase colon-free SHA-256 of the leaf. Connection-pool key and log identifier. */
  fingerprintSha256?: string;
  subject?: string;
  notAfter?: string;
  /** Always true except behind the explicit staging escape hatch — see assertTlsPolicy. */
  rejectUnauthorized: boolean;
}

/** Normalise a PEM supplied either as literal text (possibly with escaped \n) or base64. */
function readPem(text: string | undefined, b64: string | undefined): string | undefined {
  if (b64) return Buffer.from(b64, "base64").toString("utf8");
  if (!text) return undefined;
  return text.includes("\\n") ? text.replace(/\\n/g, "\n") : text;
}

/**
 * Deploy-wide TLS material from env vars, or null when none is set.
 *
 * Throws on a half-configured client identity. Silently falling back to anonymous TLS would surface
 * days later as an opaque 403 from EFS; failing here names the missing variable.
 */
export function envTlsMaterial(env: Env): EfsTlsMaterial | null {
  const cert = readPem(env.EFS_SOAP_CLIENT_CERT_PEM, env.EFS_SOAP_CLIENT_CERT_B64);
  const key = readPem(env.EFS_SOAP_CLIENT_KEY_PEM, env.EFS_SOAP_CLIENT_KEY_B64);
  const ca = readPem(env.EFS_SOAP_CA_PEM, env.EFS_SOAP_CA_B64);
  const pfx = env.EFS_SOAP_CLIENT_PFX_B64 ? Buffer.from(env.EFS_SOAP_CLIENT_PFX_B64, "base64") : undefined;
  const insecure = env.EFS_SOAP_TLS_INSECURE === true;
  if (!cert && !key && !ca && !pfx && !insecure) return null;
  if ((cert && !key) || (key && !cert)) {
    throw new Error(
      "EFS SOAP mTLS is half-configured: set BOTH EFS_SOAP_CLIENT_CERT_PEM/_B64 and EFS_SOAP_CLIENT_KEY_PEM/_B64 (or use EFS_SOAP_CLIENT_PFX_B64), or neither.",
    );
  }
  const material: EfsTlsMaterial = {
    source: "env",
    ...(cert ? { cert } : {}),
    ...(key ? { key } : {}),
    ...(env.EFS_SOAP_CLIENT_KEY_PASSPHRASE ? { passphrase: env.EFS_SOAP_CLIENT_KEY_PASSPHRASE } : {}),
    ...(ca ? { ca } : {}),
    ...(pfx ? { pfx, passphrase: env.EFS_SOAP_CLIENT_PFX_PASSPHRASE } : {}),
    rejectUnauthorized: !insecure,
  };
  // Identify the env-supplied certificate the same way a stored one is identified, so pooling,
  // logging and the status endpoint don't care which source it came from.
  if (cert) {
    try {
      const leaf = new X509Certificate(cert);
      material.fingerprintSha256 = leaf.fingerprint256.replace(/:/g, "").toLowerCase();
      material.subject = leaf.subject.replace(/\n/g, ", ");
      material.notAfter = new Date(leaf.validTo).toISOString();
    } catch {
      throw new Error("EFS_SOAP_CLIENT_CERT_PEM/_B64 is not a parseable PEM certificate.");
    }
  }
  return material;
}

/**
 * Policy gate, applied on every request that carries TLS material.
 *
 * Disabling certificate verification turns mutual TLS into theatre — it authenticates us to EFS while
 * accepting any server that answers. That is a legitimate thing to want against a self-signed staging
 * endpoint and an illegitimate thing to ship, so it is refused outright when NODE_ENV=production
 * rather than merely warned about. A warning would be ignored; a thrown error cannot be.
 */
export function assertTlsPolicy(env: Env, tls: EfsTlsMaterial): void {
  if (!tls.rejectUnauthorized && env.NODE_ENV === "production") {
    throw new Error(
      "EFS_SOAP_TLS_INSECURE=true is refused in production — it disables server certificate verification. Install the endpoint's CA via EFS_SOAP_CA_PEM instead.",
    );
  }
}

/** One-line, secret-free description for boot logs, audit entries and the status endpoint. */
export function describeTlsMaterial(tls: EfsTlsMaterial | null): string {
  if (!tls) return "standard TLS (no client certificate configured)";
  const parts: string[] = [];
  if (tls.pfx) parts.push("client certificate (PKCS#12)");
  else if (tls.cert) parts.push(`client certificate (PEM${tls.subject ? `, ${tls.subject}` : ""})`);
  if (tls.ca) parts.push("custom CA bundle");
  parts.push(tls.source === "org" ? "per-org" : "deploy env");
  if (!tls.rejectUnauthorized) parts.push("⚠️ CERTIFICATE VERIFICATION DISABLED — do not use in production");
  return parts.join(" + ");
}

/** Back-compat: the deploy-wide view, for callers that have no org context (boot logs). */
export function describeEfsTls(env: Env): string {
  try {
    return describeTlsMaterial(envTlsMaterial(env));
  } catch (e) {
    return `misconfigured — ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Back-compat alias kept for existing callers/tests of the env-only accessor. */
export const efsTlsOptions = envTlsMaterial;

// ── Connection pooling ──────────────────────────────────────────────────────────────────────────
//
// One HTTPS agent per TLS identity, keep-alive on. A fresh agent per request would mean a fresh TLS
// handshake per request — for mutual TLS that is an RSA signature each time, and it defeats session
// resumption entirely. The pool is bounded and evicts least-recently-used, because in a multi-tenant
// deploy the key space is "number of orgs with a certificate" and an unbounded map of live sockets is
// a slow leak.

const MAX_POOLED_AGENTS = 32;
const agents = new Map<string, HttpsAgent>();

function agentKey(tls: EfsTlsMaterial): string {
  // Identity, not material: the fingerprint changes on rotation, which is exactly when the pooled
  // sockets must stop being reused. Key material is never part of the key.
  return [
    tls.source,
    tls.certId ?? "-",
    tls.fingerprintSha256 ?? (tls.pfx ? `pfx:${tls.pfx.length}` : "none"),
    tls.ca ? createHash("sha256").update(tls.ca).digest("hex").slice(0, 16) : "-",
    tls.rejectUnauthorized ? "verify" : "insecure",
  ].join("|");
}

function agentFor(tls: EfsTlsMaterial): HttpsAgent {
  const key = agentKey(tls);
  const existing = agents.get(key);
  if (existing) {
    // Refresh LRU position.
    agents.delete(key);
    agents.set(key, existing);
    return existing;
  }
  const agent = new HttpsAgent({
    keepAlive: true,
    maxSockets: 8,
    minVersion: MIN_TLS_VERSION,
    ...(tls.cert ? { cert: tls.cert } : {}),
    ...(tls.key ? { key: tls.key } : {}),
    ...(tls.passphrase ? { passphrase: tls.passphrase } : {}),
    ...(tls.ca ? { ca: tls.ca } : {}),
    ...(tls.pfx ? { pfx: tls.pfx } : {}),
    rejectUnauthorized: tls.rejectUnauthorized,
  });
  agents.set(key, agent);
  while (agents.size > MAX_POOLED_AGENTS) {
    const oldest = agents.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    agents.get(oldest)?.destroy();
    agents.delete(oldest);
  }
  return agent;
}

/** Drop pooled sockets for a certificate (on rotation/withdrawal) — or all of them when omitted. */
export function invalidateTlsAgents(fingerprintOrCertId?: string): number {
  let dropped = 0;
  for (const [key, agent] of [...agents]) {
    if (fingerprintOrCertId && !key.includes(fingerprintOrCertId)) continue;
    agent.destroy();
    agents.delete(key);
    dropped += 1;
  }
  return dropped;
}

// ── TLS error classification ────────────────────────────────────────────────────────────────────

export type TlsFailureKind =
  | "client_cert_rejected"
  | "client_cert_expired"
  | "server_cert_untrusted"
  | "server_hostname_mismatch"
  | "tls_version"
  | "key_unusable"
  | "network"
  | "unknown";

export interface TlsFailure {
  kind: TlsFailureKind;
  /** What an operator should DO about it — this is the text that reaches the settings UI. */
  message: string;
  /** The raw Node/OpenSSL code, kept for support tickets. */
  code: string | null;
}

/**
 * Turn a Node TLS error into something actionable. A raw `EPROTO ... alert handshake failure` tells an
 * operator nothing; "EFS rejected our client certificate — confirm they enrolled this fingerprint" is
 * the difference between a five-minute fix and a support ticket.
 */
export function classifyTlsError(err: unknown): TlsFailure {
  const e = err as { code?: string; message?: string; reason?: string } | null;
  const code = e?.code ?? null;
  const text = `${code ?? ""} ${e?.message ?? ""} ${e?.reason ?? ""}`.toLowerCase();

  if (/err_ossl_x509_key_values_mismatch|key values mismatch/.test(text)) {
    return { kind: "key_unusable", code, message: "The configured private key does not match the client certificate. Re-upload the matching pair." };
  }
  if (/bad decrypt|passphrase|pkcs12|mac verify failure/.test(text)) {
    return { kind: "key_unusable", code, message: "The private key (or PKCS#12 bundle) could not be decrypted — check the passphrase." };
  }
  if (/cert_has_expired|certificate has expired/.test(text)) {
    return { kind: "client_cert_expired", code, message: "A certificate in the handshake has expired. Check both our client certificate and EFS's server certificate." };
  }
  if (/alert (handshake failure|certificate (unknown|required|expired|revoked))|sslv3 alert|tlsv1 alert|epro?to/.test(text)) {
    return {
      kind: "client_cert_rejected",
      code,
      message: "EFS rejected the TLS handshake. Most often this means our client certificate is not enrolled on their side, or they expected one and none was presented — confirm the fingerprint with EFS.",
    };
  }
  if (/unable_to_verify_leaf_signature|self_signed_cert|self-signed|unable_to_get_issuer|depth_zero_self_signed/.test(text)) {
    return { kind: "server_cert_untrusted", code, message: "EFS's server certificate could not be verified against the trusted roots. If they use a private CA, install it via the CA bundle field / EFS_SOAP_CA_PEM." };
  }
  if (/altname|hostname\/ip does not match|err_tls_cert_altname_invalid/.test(text)) {
    return { kind: "server_hostname_mismatch", code, message: "EFS's certificate does not cover the endpoint hostname. Verify the endpoint URL is exactly what EFS issued the certificate for." };
  }
  if (/unsupported_protocol|no_protocols_available|version too low|wrong_version_number/.test(text)) {
    return { kind: "tls_version", code, message: `The endpoint could not negotiate ${MIN_TLS_VERSION} or better. Confirm with EFS which TLS versions their endpoint supports.` };
  }
  if (/econnrefused|econnreset|etimedout|enotfound|ehostunreach|socket hang up/.test(text)) {
    return { kind: "network", code, message: "Could not reach the EFS endpoint. Check the URL and whether our egress IPs are still allowlisted." };
  }
  return { kind: "unknown", code, message: e?.message ?? "TLS request failed." };
}

/** POST over node:https with the configured client certificate. Same result shape as fetch. */
function httpsPost(url: string, headers: Record<string, string>, body: string, tls: EfsTlsMaterial): Promise<SoapResponse> {
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
            // set-cookie arrives as an array; cookieHeader() in efsSoap.ts re-splits a joined value.
            out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
          }
          resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

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
  /**
   * Resolved TLS material for THIS request. Passed in rather than resolved here because the per-org
   * certificate lives in the database and unsealing it is the credentials layer's job — this file
   * stays synchronous and DB-free. `undefined` falls back to the deploy-wide env material; explicit
   * `null` forces ordinary TLS (used by the tests).
   */
  tls?: EfsTlsMaterial | null;
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
  // Precedence: explicit material (per-org, resolved by the credentials layer) → deploy-wide env →
  // none. An injected fetch (tests) that did NOT ask for TLS bypasses the https path entirely, so the
  // mTLS layer can never interfere with the existing suite.
  const tls =
    opts.tls === null ? null : (opts.tls ?? (opts.fetchImpl ? null : envTlsMaterial(env)));
  if (tls) assertTlsPolicy(env, tls);

  const headers: Record<string, string> = {
    "Content-Type": 'text/xml; charset="utf-8"',
    ...(opts.soapAction !== null ? { SOAPAction: opts.soapAction ?? "" } : {}),
    ...(opts.headers ?? {}),
  };

  let attempt = 0;
  for (;;) {
    const wait = reserveSlot(slotKey, rps);
    if (wait > 0) await sleep(wait);
    let out: SoapResponse;
    try {
      if (tls) {
        out = await httpsPost(opts.url, headers, opts.body, tls);
      } else {
        const res = await doFetch(opts.url, { method: "POST", headers, body: opts.body });
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const ra = parseRetryAfter(res.headers.get("retry-after"));
          await sleep(ra ?? backoffMs(attempt));
          attempt++;
          continue;
        }
        // Read the body once; downstream parses XML regardless of status (faults are in the body).
        return { status: res.status, headers: res.headers, body: await res.text() };
      }
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await sleep(backoffMs(attempt++));
      continue;
    }
    if ((out.status === 429 || out.status >= 500) && attempt < maxRetries) {
      const ra = parseRetryAfter(out.headers.get("retry-after"));
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
