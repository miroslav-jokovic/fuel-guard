import { X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";

/**
 * X.509 inspection + validation for the EFS client certificate.
 *
 * Everything here is `node:crypto` — no new dependency for a capability that must be auditable. The
 * job is to turn "the operator pasted some PEM" into either a precise, actionable rejection or a
 * described, verified identity we are willing to present to EFS.
 *
 * The validation posture is DELIBERATELY strict at the point of upload, because the alternative is
 * discovering the problem as an opaque TLS handshake failure in production at 03:00. A key that
 * doesn't match its certificate, an expired certificate, or a chain in the wrong order are all
 * caught here with a message that says what to fix.
 */

export class CertificateError extends Error {
  constructor(
    message: string,
    public code:
      | "unparseable_cert"
      | "unparseable_key"
      | "key_mismatch"
      | "expired"
      | "not_yet_valid"
      | "no_client_auth"
      | "unparseable_ca"
      | "chain_broken",
  ) {
    super(message);
    this.name = "CertificateError";
  }
}

/** Non-secret description of a certificate. Safe to log, to return over the API, and to audit. */
export interface CertInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  /** Colon-free lowercase SHA-256 fingerprint — the stable identifier we key agents and audits on. */
  fingerprintSha256: string;
  notBefore: string; // ISO
  notAfter: string; // ISO
  /** Certificates supplied in the PEM blob (leaf + any intermediates). */
  chainLength: number;
  /** Public key algorithm + size, e.g. "RSA 2048" / "EC P-256". */
  keyType: string;
  /** True when the leaf carries extendedKeyUsage=clientAuth (or carries no EKU at all). */
  clientAuth: boolean;
}

export type CertExpiryState = "valid" | "expiring" | "expired" | "not_yet_valid";

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** Normalise PEM text supplied with escaped newlines (single-line env vars / JSON bodies). */
export function normalizePem(text: string): string {
  const t = text.includes("\\n") ? text.replace(/\\n/g, "\n") : text;
  return t.replace(/\r\n/g, "\n").trim() + "\n";
}

/** Split a PEM blob into its certificates, leaf first (the conventional order). */
export function parseCertChain(pem: string): X509Certificate[] {
  const blocks = normalizePem(pem).match(PEM_BLOCK);
  if (!blocks?.length) {
    throw new CertificateError(
      "No PEM certificate found. Expected text beginning with '-----BEGIN CERTIFICATE-----'.",
      "unparseable_cert",
    );
  }
  try {
    return blocks.map((b) => new X509Certificate(b));
  } catch (e) {
    throw new CertificateError(
      `Certificate could not be parsed: ${e instanceof Error ? e.message : String(e)}`,
      "unparseable_cert",
    );
  }
}

function keyTypeOf(cert: X509Certificate): string {
  try {
    const k = cert.publicKey.asymmetricKeyDetails ?? {};
    if (cert.publicKey.asymmetricKeyType === "rsa") return `RSA ${k.modulusLength ?? "?"}`;
    if (cert.publicKey.asymmetricKeyType === "ec") return `EC ${k.namedCurve ?? "?"}`;
    return cert.publicKey.asymmetricKeyType ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Does the leaf permit client authentication? A cert with NO extendedKeyUsage is unrestricted and
 * therefore usable; one that lists EKUs must include clientAuth (OID 1.3.6.1.5.5.7.3.2). Getting a
 * serverAuth-only certificate from an issuer by mistake is common enough to be worth catching.
 */
function permitsClientAuth(cert: X509Certificate): boolean {
  const eku = (cert as unknown as { keyUsage?: string[] }).keyUsage;
  if (!eku || eku.length === 0) return true;
  return eku.includes("1.3.6.1.5.5.7.3.2");
}

export function describeCert(cert: X509Certificate, chainLength = 1): CertInfo {
  return {
    subject: cert.subject.replace(/\n/g, ", "),
    issuer: cert.issuer.replace(/\n/g, ", "),
    serialNumber: cert.serialNumber,
    fingerprintSha256: cert.fingerprint256.replace(/:/g, "").toLowerCase(),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
    chainLength,
    keyType: keyTypeOf(cert),
    clientAuth: permitsClientAuth(cert),
  };
}

/**
 * Verify the private key really belongs to the certificate. This is the single most valuable check
 * here: a mismatched pair produces `ERR_OSSL_X509_KEY_VALUES_MISMATCH` deep inside a TLS handshake,
 * which reads like a network problem and wastes an afternoon. Compares the DER-encoded SPKI of the
 * key's public half against the certificate's public key.
 */
export function assertKeyMatchesCert(cert: X509Certificate, keyPem: string, passphrase?: string): void {
  const pem = normalizePem(keyPem);
  // Detect an encrypted key with no passphrase BEFORE handing it to OpenSSL. Left to OpenSSL it
  // reports "interrupted or cancelled" (it tried to prompt on a terminal that isn't there), which
  // tells the operator nothing at all.
  if (!passphrase && /ENCRYPTED PRIVATE KEY|Proc-Type:.*ENCRYPTED|DEK-Info:/i.test(pem)) {
    throw new CertificateError(
      "The private key is encrypted but no passphrase was supplied.",
      "unparseable_key",
    );
  }
  let key;
  try {
    key = createPrivateKey(passphrase ? { key: pem, passphrase } : { key: pem });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CertificateError(
      /bad decrypt|passphrase|password|interrupted or cancelled|mac verify/i.test(msg)
        ? "Private key could not be decrypted — wrong or missing passphrase."
        : `Private key could not be parsed: ${msg}`,
      "unparseable_key",
    );
  }
  // Re-import the private key's PEM to derive its public half. `createPublicKey(KeyObject)` works at
  // runtime but is not in @types/node's accepted union; going through PKCS#8 PEM keeps this typed
  // without an `as any`, and the cost is one in-memory round trip on an operator action.
  const fromKey = createPublicKey({
    key: key.export({ format: "pem", type: "pkcs8" }) as string,
    format: "pem",
  }).export({ type: "spki", format: "der" });
  const fromCert = cert.publicKey.export({ type: "spki", format: "der" });
  if (!fromKey.equals(fromCert)) {
    throw new CertificateError(
      "The private key does not match the certificate — they are from different key pairs.",
      "key_mismatch",
    );
  }
}

/** Where a certificate sits relative to now. `warnDays` decides the 'expiring' band. */
export function certExpiryState(info: Pick<CertInfo, "notBefore" | "notAfter">, now: Date, warnDays: number): CertExpiryState {
  const t = now.getTime();
  if (t < Date.parse(info.notBefore)) return "not_yet_valid";
  const remainingMs = Date.parse(info.notAfter) - t;
  if (remainingMs <= 0) return "expired";
  return remainingMs <= warnDays * 86_400_000 ? "expiring" : "valid";
}

/** Whole days until expiry (negative once expired). */
export function daysUntil(iso: string, now: Date): number {
  return Math.floor((Date.parse(iso) - now.getTime()) / 86_400_000);
}

export interface ClientCertBundle {
  certPem: string;
  keyPem: string;
  passphrase?: string | undefined;
  caPem?: string | undefined;
}

export interface ValidatedClientCert {
  info: CertInfo;
  certPem: string;
  keyPem: string;
  caPem: string | null;
  /** Non-fatal observations an operator should see (near expiry, self-signed CA, no chain, …). */
  warnings: string[];
}

/**
 * Full pre-flight on an uploaded client identity. Throws CertificateError on anything that would make
 * the certificate unusable; returns normalised PEMs plus warnings for anything merely questionable.
 *
 * An ALREADY-EXPIRED certificate is rejected outright rather than warned about: accepting one would
 * guarantee a production handshake failure, and there is no scenario where storing it is what the
 * operator meant. A NOT-YET-VALID one is rejected for the same reason (and it usually means a clock
 * or a wrong-file problem worth surfacing now).
 */
export function validateClientCert(bundle: ClientCertBundle, now = new Date(), warnDays = 30): ValidatedClientCert {
  const chain = parseCertChain(bundle.certPem);
  const leaf = chain[0]!;
  const info = describeCert(leaf, chain.length);
  const warnings: string[] = [];

  const state = certExpiryState(info, now, warnDays);
  if (state === "expired") {
    throw new CertificateError(
      `Certificate expired on ${info.notAfter.slice(0, 10)}. Obtain a current certificate from the issuer before uploading.`,
      "expired",
    );
  }
  if (state === "not_yet_valid") {
    throw new CertificateError(
      `Certificate is not valid until ${info.notBefore.slice(0, 10)}. Check the server clock, or wait until it becomes valid.`,
      "not_yet_valid",
    );
  }
  if (state === "expiring") {
    warnings.push(`Certificate expires in ${daysUntil(info.notAfter, now)} days (${info.notAfter.slice(0, 10)}).`);
  }

  if (!info.clientAuth) {
    throw new CertificateError(
      "Certificate does not permit client authentication (extendedKeyUsage lacks clientAuth). This looks like a server certificate — ask the issuer for a client certificate.",
      "no_client_auth",
    );
  }

  assertKeyMatchesCert(leaf, bundle.keyPem, bundle.passphrase);

  // Chain order: each certificate after the leaf should issue the one before it. A blob assembled in
  // the wrong order still "parses" but many servers reject the handshake, so say so up front.
  for (let i = 0; i + 1 < chain.length; i++) {
    if (!chain[i]!.checkIssued(chain[i + 1]!)) {
      warnings.push(
        `Certificate #${i + 2} in the bundle does not appear to issue #${i + 1} — check the chain order (leaf first, then intermediates, root last or omitted).`,
      );
      break;
    }
  }
  if (chain.length === 1 && leaf.issuer !== leaf.subject) {
    warnings.push("No intermediate certificates supplied. If EFS requires the full chain, append the intermediates below the leaf.");
  }

  let caPem: string | null = null;
  if (bundle.caPem?.trim()) {
    try {
      const ca = parseCertChain(bundle.caPem);
      caPem = normalizePem(bundle.caPem);
      if (ca.length === 1 && ca[0]!.subject === ca[0]!.issuer) {
        warnings.push(`CA bundle is a single self-signed root (${ca[0]!.subject.replace(/\n/g, ", ")}).`);
      }
    } catch (e) {
      throw new CertificateError(
        `CA bundle could not be parsed: ${e instanceof Error ? e.message : String(e)}`,
        "unparseable_ca",
      );
    }
  }

  return {
    info,
    certPem: normalizePem(bundle.certPem),
    keyPem: normalizePem(bundle.keyPem),
    caPem,
    warnings,
  };
}
