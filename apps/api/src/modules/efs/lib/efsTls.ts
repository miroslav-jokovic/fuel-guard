import { createHash, X509Certificate } from "node:crypto";
import { Agent as HttpsAgent } from "node:https";
import type { Env } from "../../../env.js";

/**
 * Mutual-TLS material, connection pooling and handshake-error classification for the EFS SOAP client.
 *
 * Extracted from `soapClient.ts` (which kept HTTP dispatch, pacing and retries) so that file could
 * come back under the 500-line budget and drop its grandfather waiver. Nothing here is WSDL-specific
 * and nothing here opens a socket — this module resolves, validates, pools and explains certificate
 * material; `soapClient.ts` is the only caller that dispatches with it.
 *
 * `soapClient.ts` re-exports every public symbol below, so existing importers are unaffected.
 */

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

export function agentFor(tls: EfsTlsMaterial): HttpsAgent {
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
