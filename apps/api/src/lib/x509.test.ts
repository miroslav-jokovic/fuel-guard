import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CertificateError, certExpiryState, daysUntil, describeCert, normalizePem, parseCertChain, validateClientCert } from "./x509.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "mtls");
const fx = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const CA = fx("ca.crt");
const CLIENT_CERT = fx("client.crt");
const CLIENT_KEY = fx("client.key");
const CLIENT_KEY_ENC = fx("client.enc.key");
const CLIENT2_KEY = fx("client2.key");
const SERVER_CERT = fx("server.crt");
const ROGUE_CA = fx("rogue-ca.crt");
const EXPIRED_CERT = fx("expired-client.crt");
const EXPIRED_KEY = fx("expired-client.key");
const EXPIRING_SOON_CERT = fx("expiring-soon.crt"); // valid 2026-01-01 → 2026-09-01

// After the fixtures' notBefore (they are generated at build time) and 22 days before the
// "expiring soon" fixture lapses, so the warning band is exercised deterministically.
const NOW = new Date("2026-08-10T00:00:00Z");

describe("parseCertChain / describeCert", () => {
  it("describes a certificate without touching any private material", () => {
    const info = describeCert(parseCertChain(CLIENT_CERT)[0]!);
    expect(info.subject).toContain("CN=fuelguard-efs-client");
    expect(info.issuer).toContain("CN=FuelGuard Test Root CA");
    expect(info.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/); // lowercase, colon-free
    expect(info.keyType).toBe("RSA 2048");
    expect(info.clientAuth).toBe(true);
    expect(info.serialNumber).toMatch(/^[0-9A-F]+$/);
  });

  it("splits a bundle into leaf + intermediates, leaf first", () => {
    const chain = parseCertChain(`${CLIENT_CERT}\n${CA}`);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.subject).toContain("fuelguard-efs-client");
    expect(chain[1]!.subject).toContain("FuelGuard Test Root CA");
  });

  it("accepts PEM with escaped newlines (single-line env vars / JSON bodies)", () => {
    const escaped = CLIENT_CERT.replace(/\n/g, "\\n");
    expect(parseCertChain(escaped)).toHaveLength(1);
    expect(normalizePem(escaped)).toBe(normalizePem(CLIENT_CERT));
  });

  it("rejects non-certificate input with a message that says what was expected", () => {
    expect(() => parseCertChain("hello")).toThrow(/-----BEGIN CERTIFICATE-----/);
    expect(() => parseCertChain(CLIENT_KEY)).toThrow(CertificateError); // a KEY pasted into the CERT field
  });
});

describe("validateClientCert — the upload gate", () => {
  const base = { certPem: CLIENT_CERT, keyPem: CLIENT_KEY };

  it("accepts a valid pair and returns normalised PEMs", () => {
    const v = validateClientCert(base, NOW);
    expect(v.info.subject).toContain("fuelguard-efs-client");
    expect(v.certPem.endsWith("\n")).toBe(true);
    expect(v.caPem).toBeNull();
  });

  it("catches a key that does not belong to the certificate", () => {
    // The highest-value check here: this pair fails deep inside a TLS handshake with a message that
    // reads like a network fault. Catching it on upload turns an outage into a form error.
    expect(() => validateClientCert({ certPem: CLIENT_CERT, keyPem: CLIENT2_KEY }, NOW)).toThrow(/different key pairs/);
    try {
      validateClientCert({ certPem: CLIENT_CERT, keyPem: CLIENT2_KEY }, NOW);
    } catch (e) {
      expect((e as CertificateError).code).toBe("key_mismatch");
    }
  });

  it("accepts an encrypted key with the right passphrase and rejects the wrong one", () => {
    expect(() => validateClientCert({ ...base, keyPem: CLIENT_KEY_ENC, passphrase: "testpass" }, NOW)).not.toThrow();
    expect(() => validateClientCert({ ...base, keyPem: CLIENT_KEY_ENC, passphrase: "nope" }, NOW)).toThrow(
      /wrong or missing passphrase/,
    );
    expect(() => validateClientCert({ ...base, keyPem: CLIENT_KEY_ENC }, NOW)).toThrow(
      /encrypted but no passphrase was supplied/,
    );
  });

  it("refuses an already-expired certificate outright", () => {
    // Storing one would guarantee a production handshake failure — there is no reading of the
    // operator's intent under which accepting it is right.
    expect(() => validateClientCert({ certPem: EXPIRED_CERT, keyPem: EXPIRED_KEY }, NOW)).toThrow(/expired on 2021-01-01/);
  });

  it("refuses a server certificate mistakenly uploaded as a client certificate", () => {
    expect(() => validateClientCert({ certPem: SERVER_CERT, keyPem: fx("server.key") }, NOW)).toThrow(
      /does not permit client authentication/,
    );
  });

  it("warns — but does not refuse — when expiry is inside the warning band", () => {
    const v = validateClientCert({ certPem: EXPIRING_SOON_CERT, keyPem: CLIENT2_KEY }, NOW, 30);
    expect(v.warnings.some((w) => /expires in \d+ days/.test(w))).toBe(true);
  });

  it("warns when no intermediates are supplied", () => {
    const v = validateClientCert(base, NOW);
    expect(v.warnings.some((w) => /No intermediate certificates/.test(w))).toBe(true);
  });

  it("accepts a CA bundle and notes when it is a bare self-signed root", () => {
    const v = validateClientCert({ ...base, caPem: CA }, NOW);
    expect(v.caPem).not.toBeNull();
    expect(v.warnings.some((w) => /self-signed root/.test(w))).toBe(true);
  });

  it("rejects an unparseable CA bundle rather than storing it and failing later", () => {
    expect(() => validateClientCert({ ...base, caPem: "not a ca" }, NOW)).toThrow(/CA bundle could not be parsed/);
  });

  it("flags a bundle whose second certificate did not issue the leaf", () => {
    // A real symptom of copy-pasting the wrong intermediate: it parses, it looks like a chain, and
    // many servers then refuse the handshake with nothing useful in the message.
    const v = validateClientCert({ certPem: `${CLIENT_CERT}\n${ROGUE_CA}`, keyPem: CLIENT_KEY }, NOW);
    expect(v.warnings.some((w) => /check the chain order/.test(w))).toBe(true);
  });
});

describe("expiry arithmetic", () => {
  const info = { notBefore: "2026-01-01T00:00:00Z", notAfter: "2026-09-01T00:00:00Z" };

  it("classifies valid / expiring / expired / not-yet-valid", () => {
    expect(certExpiryState(info, new Date("2026-03-01T00:00:00Z"), 30)).toBe("valid");
    expect(certExpiryState(info, new Date("2026-08-20T00:00:00Z"), 30)).toBe("expiring");
    expect(certExpiryState(info, new Date("2026-09-02T00:00:00Z"), 30)).toBe("expired");
    expect(certExpiryState(info, new Date("2025-12-01T00:00:00Z"), 30)).toBe("not_yet_valid");
  });

  it("counts whole days, negative once past", () => {
    expect(daysUntil(info.notAfter, new Date("2026-08-02T00:00:00Z"))).toBe(30);
    expect(daysUntil(info.notAfter, new Date("2026-09-11T00:00:00Z"))).toBe(-10);
  });

  it("treats the exact expiry instant as expired, not as valid", () => {
    expect(certExpiryState(info, new Date(info.notAfter), 30)).toBe("expired");
  });
});
