import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { describeEfsTls, efsTlsOptions } from "./soapClient.js";

/**
 * The mTLS layer ships INERT (EFS has not yet confirmed whether they require a client certificate),
 * so the most important property under test is that an unconfigured deploy behaves exactly as before.
 */

const base = { EFS_SOAP_TLS_INSECURE: false } as unknown as Env;
const withEnv = (over: Record<string, unknown>): Env => ({ ...base, ...over }) as Env;

const CERT = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const KEY = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n";

describe("efsTlsOptions — optional EFS client certificate", () => {
  it("returns null when nothing is configured (→ ordinary fetch, unchanged behaviour)", () => {
    expect(efsTlsOptions(base)).toBeNull();
    expect(describeEfsTls(base)).toBe("standard TLS (no client certificate configured)");
  });

  it("loads a PEM client identity", () => {
    const tls = efsTlsOptions(withEnv({ EFS_SOAP_CLIENT_CERT_PEM: CERT, EFS_SOAP_CLIENT_KEY_PEM: KEY }));
    expect(tls?.cert).toBe(CERT);
    expect(tls?.key).toBe(KEY);
    expect(tls?.rejectUnauthorized).toBe(true);
    expect(describeEfsTls(withEnv({ EFS_SOAP_CLIENT_CERT_PEM: CERT, EFS_SOAP_CLIENT_KEY_PEM: KEY }))).toContain("client certificate (PEM)");
  });

  it("accepts escaped newlines (Railway/Docker single-line env vars) and base64", () => {
    const escaped = CERT.replace(/\n/g, "\\n");
    const tls = efsTlsOptions(
      withEnv({ EFS_SOAP_CLIENT_CERT_PEM: escaped, EFS_SOAP_CLIENT_KEY_B64: Buffer.from(KEY).toString("base64") }),
    );
    expect(tls?.cert).toBe(CERT);
    expect(tls?.key).toBe(KEY);
  });

  it("rejects a half-configured identity instead of silently falling back to anonymous TLS", () => {
    expect(() => efsTlsOptions(withEnv({ EFS_SOAP_CLIENT_CERT_PEM: CERT }))).toThrow(/half-configured/);
    expect(() => efsTlsOptions(withEnv({ EFS_SOAP_CLIENT_KEY_PEM: KEY }))).toThrow(/half-configured/);
    expect(describeEfsTls(withEnv({ EFS_SOAP_CLIENT_CERT_PEM: CERT }))).toContain("misconfigured");
  });

  it("supports a CA bundle on its own (private root, no client cert)", () => {
    const tls = efsTlsOptions(withEnv({ EFS_SOAP_CA_PEM: CERT }));
    expect(tls?.ca).toBe(CERT);
    expect(tls?.cert).toBeUndefined();
    expect(describeEfsTls(withEnv({ EFS_SOAP_CA_PEM: CERT }))).toBe("custom CA bundle");
  });

  it("supports PKCS#12 for issuers that only hand out a .pfx", () => {
    const tls = efsTlsOptions(
      withEnv({ EFS_SOAP_CLIENT_PFX_B64: Buffer.from("pfx-bytes").toString("base64"), EFS_SOAP_CLIENT_PFX_PASSPHRASE: "s3cret" }),
    );
    expect(tls?.pfx?.toString()).toBe("pfx-bytes");
    expect(tls?.passphrase).toBe("s3cret");
    expect(describeEfsTls(withEnv({ EFS_SOAP_CLIENT_PFX_B64: Buffer.from("x").toString("base64") }))).toContain("PKCS#12");
  });

  it("says so loudly when certificate verification is disabled", () => {
    const insecure = withEnv({ EFS_SOAP_TLS_INSECURE: true });
    expect(efsTlsOptions(insecure)?.rejectUnauthorized).toBe(false);
    expect(describeEfsTls(insecure)).toContain("CERTIFICATE VERIFICATION DISABLED");
  });
});
