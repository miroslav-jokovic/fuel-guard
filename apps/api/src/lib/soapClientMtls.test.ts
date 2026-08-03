import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import {
  __resetSoapPacing,
  assertTlsPolicy,
  classifyTlsError,
  describeTlsMaterial,
  envTlsMaterial,
  invalidateTlsAgents,
  soapFetch,
  type EfsTlsMaterial,
} from "./soapClient.js";

/**
 * END-TO-END MUTUAL TLS.
 *
 * These tests do not mock the transport. They stand up a real HTTPS server that DEMANDS a client
 * certificate signed by a known CA — the same posture EFS would have — and drive `soapFetch` against
 * it over a real socket. Everything that can only be verified by an actual handshake is verified
 * here: that we present the certificate at all, that the server can read our subject from it, that an
 * untrusted client is refused, that an untrusted server is refused, that encrypted keys and PKCS#12
 * bundles work, and that connections are pooled per identity and dropped on rotation.
 *
 * A mocked `fetch` cannot tell you any of that. Given this code path holds a private key and is the
 * thing standing between the fuel feed and an outage, an integration test is the minimum bar.
 *
 * Fixtures in __fixtures__/mtls are a self-contained PKI generated with OpenSSL (see the README
 * there). The valid certificates are dated to expire in 2126 so the suite cannot rot.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "mtls");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const CA = fixture("ca.crt");
const SERVER_CERT = fixture("server.crt");
const SERVER_KEY = fixture("server.key");
const CLIENT_CERT = fixture("client.crt");
const CLIENT_KEY = fixture("client.key");
const CLIENT_KEY_ENC = fixture("client.enc.key");
const CLIENT2_CERT = fixture("client2.crt");
const CLIENT2_KEY = fixture("client2.key");
const ROGUE_CERT = fixture("rogue-client.crt");
const ROGUE_KEY = fixture("rogue-client.key");
const CLIENT_PFX = Buffer.from(fixture("client.p12.b64").trim(), "base64");

const env = {
  NODE_ENV: "test",
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
} as Env;

const SOAP_OK = '<?xml version="1.0"?><ok/>';

/** What the server observed about each connection — the proof that mTLS actually happened. */
interface Observed {
  authorized: boolean;
  clientSubjectCN: string | null;
  authorizationError: string | null;
}

let server: Server;
let url: string;
let observed: Observed[] = [];
let connections = 0;

beforeAll(async () => {
  server = createServer(
    {
      cert: SERVER_CERT,
      key: SERVER_KEY,
      ca: CA,
      // The EFS posture we are simulating: a client certificate is REQUIRED and must chain to our CA.
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    (req, res) => {
      const socket = req.socket as TLSSocket;
      const peer = socket.getPeerCertificate();
      observed.push({
        authorized: socket.authorized,
        clientSubjectCN: (peer?.subject as { CN?: string } | undefined)?.CN ?? null,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
      });
      // Drain the request body so keep-alive works, then answer.
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(SOAP_OK);
      });
    },
  );
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `https://localhost:${(server.address() as AddressInfo).port}/CardManagementWS`;
});

afterAll(async () => {
  invalidateTlsAgents();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  observed = [];
  connections = 0;
  invalidateTlsAgents();
  __resetSoapPacing();
});

/** Client material trusting the test CA — the shape efsSoapCredentials resolves for a real org. */
const clientMaterial = (over: Partial<EfsTlsMaterial> = {}): EfsTlsMaterial => ({
  source: "org",
  certId: "cert-1",
  cert: CLIENT_CERT,
  key: CLIENT_KEY,
  ca: CA,
  fingerprintSha256: "aaaa1111",
  rejectUnauthorized: true,
  ...over,
});

const post = (tls: EfsTlsMaterial | null) =>
  soapFetch(env, "org-1:endpoint", { url, body: "<ping/>", tls, retry: false });

describe("mutual TLS — real handshake against a client-cert-requiring server", () => {
  it("presents the client certificate and the server authorizes it", async () => {
    const res = await post(clientMaterial());
    expect(res.status).toBe(200);
    expect(res.body).toBe(SOAP_OK);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.authorized).toBe(true);
    // The server can read WHO we are from the certificate — this is the property EFS relies on.
    expect(observed[0]!.clientSubjectCN).toBe("fuelguard-efs-client");
  });

  it("is refused when no client certificate is presented", async () => {
    // CA only: we trust the server, but offer no identity of our own.
    await expect(post({ source: "env", ca: CA, rejectUnauthorized: true })).rejects.toThrow();
    expect(observed).toHaveLength(0); // rejected during the handshake, never reaches the handler
  });

  it("is refused when the client certificate is signed by an unknown CA", async () => {
    await expect(
      post(clientMaterial({ cert: ROGUE_CERT, key: ROGUE_KEY, fingerprintSha256: "rogue" })),
    ).rejects.toThrow();
    expect(observed).toHaveLength(0);
  });

  it("refuses a server whose certificate we do not trust (no CA bundle configured)", async () => {
    // Same valid client identity, but we drop the CA — the server's self-signed-by-test-CA cert is
    // then unverifiable, and we must NOT connect anyway.
    const material = clientMaterial();
    delete material.ca;
    await expect(post(material)).rejects.toMatchObject({
      code: expect.stringMatching(/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT/),
    });
  });

  it("accepts an encrypted private key with its passphrase", async () => {
    const res = await post(clientMaterial({ key: CLIENT_KEY_ENC, passphrase: "testpass" }));
    expect(res.status).toBe(200);
    expect(observed[0]!.authorized).toBe(true);
  });

  it("rejects an encrypted private key with the wrong passphrase", async () => {
    await expect(post(clientMaterial({ key: CLIENT_KEY_ENC, passphrase: "wrong" }))).rejects.toThrow();
  });

  it("accepts a PKCS#12 bundle", async () => {
    const res = await post({
      source: "org",
      certId: "pfx-1",
      pfx: CLIENT_PFX,
      passphrase: "testpfx",
      ca: CA,
      rejectUnauthorized: true,
    });
    expect(res.status).toBe(200);
    expect(observed[0]!.clientSubjectCN).toBe("fuelguard-efs-client");
  });
});

describe("connection pooling and rotation", () => {
  it("reuses one TLS connection across requests with the same identity", async () => {
    await post(clientMaterial());
    await post(clientMaterial());
    await post(clientMaterial());
    expect(observed).toHaveLength(3);
    // Three SOAP calls, ONE handshake. Without pooling this would be three RSA handshakes — the cost
    // that makes an unpooled mTLS client noticeably slower than the plain-TLS one it replaced.
    expect(connections).toBe(1);
  });

  it("opens a fresh connection for a different certificate identity", async () => {
    await post(clientMaterial());
    await post(clientMaterial({ certId: "cert-2", cert: CLIENT2_CERT, key: CLIENT2_KEY, fingerprintSha256: "bbbb2222" }));
    expect(connections).toBe(2);
    expect(observed[1]!.clientSubjectCN).toBe("fuelguard-efs-client-2");
  });

  it("invalidateTlsAgents forces the next request onto a new connection (post-rotation)", async () => {
    await post(clientMaterial());
    expect(connections).toBe(1);
    const dropped = invalidateTlsAgents();
    expect(dropped).toBeGreaterThan(0);
    await post(clientMaterial());
    // Without the invalidation the second call would ride the socket established under the OLD
    // certificate — which is exactly how a rotation appears to "not take effect".
    expect(connections).toBe(2);
  });

  it("invalidateTlsAgents can target a single certificate", async () => {
    await post(clientMaterial());
    await post(clientMaterial({ certId: "cert-2", cert: CLIENT2_CERT, key: CLIENT2_KEY, fingerprintSha256: "bbbb2222" }));
    expect(invalidateTlsAgents("cert-2")).toBe(1);
    expect(invalidateTlsAgents()).toBe(1); // the first one is still pooled
  });
});

describe("plain TLS is untouched", () => {
  it("tls: null bypasses the https path entirely and uses the injected fetch", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(SOAP_OK, { status: 200 });
    }) as unknown as typeof fetch;
    const res = await soapFetch(env, "org-1:endpoint", { url, body: "<ping/>", tls: null, fetchImpl });
    expect(called).toBe(true);
    expect(res.status).toBe(200);
    expect(connections).toBe(0);
  });
});

describe("policy + configuration", () => {
  it("refuses to disable certificate verification in production", () => {
    const insecure: EfsTlsMaterial = { source: "env", rejectUnauthorized: false };
    expect(() => assertTlsPolicy({ ...env, NODE_ENV: "production" } as Env, insecure)).toThrow(/refused in production/);
    // …but allows it outside production, where a self-signed staging endpoint is a real situation.
    expect(() => assertTlsPolicy(env, insecure)).not.toThrow();
  });

  it("reads deploy-wide material from env and fingerprints it", () => {
    const material = envTlsMaterial({
      ...env,
      EFS_SOAP_CLIENT_CERT_PEM: CLIENT_CERT,
      EFS_SOAP_CLIENT_KEY_PEM: CLIENT_KEY,
      EFS_SOAP_CA_PEM: CA,
    } as Env)!;
    expect(material.source).toBe("env");
    expect(material.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(material.subject).toContain("fuelguard-efs-client");
    expect(new Date(material.notAfter!).getUTCFullYear()).toBeGreaterThan(2100);
    expect(describeTlsMaterial(material)).toContain("client certificate (PEM");
    expect(describeTlsMaterial(material)).toContain("custom CA bundle");
  });

  it("rejects a half-configured client identity rather than falling back to anonymous TLS", () => {
    expect(() => envTlsMaterial({ ...env, EFS_SOAP_CLIENT_CERT_PEM: CLIENT_CERT } as Env)).toThrow(/half-configured/);
    expect(() => envTlsMaterial({ ...env, EFS_SOAP_CLIENT_KEY_PEM: CLIENT_KEY } as Env)).toThrow(/half-configured/);
  });

  it("rejects unparseable certificate material at configuration time", () => {
    expect(() =>
      envTlsMaterial({ ...env, EFS_SOAP_CLIENT_CERT_PEM: "not a certificate", EFS_SOAP_CLIENT_KEY_PEM: CLIENT_KEY } as Env),
    ).toThrow(/not a parseable PEM certificate/);
  });

  it("accepts escaped newlines and base64 (Railway/Docker single-line env editors)", () => {
    const material = envTlsMaterial({
      ...env,
      EFS_SOAP_CLIENT_CERT_PEM: CLIENT_CERT.replace(/\n/g, "\\n"),
      EFS_SOAP_CLIENT_KEY_B64: Buffer.from(CLIENT_KEY).toString("base64"),
    } as Env)!;
    expect(material.cert).toBe(CLIENT_CERT);
    expect(material.key).toBe(CLIENT_KEY);
  });

  it("accepts a PKCS#12 bundle from env, for issuers that only hand out a .pfx", () => {
    const material = envTlsMaterial({
      ...env,
      EFS_SOAP_CLIENT_PFX_B64: CLIENT_PFX.toString("base64"),
      EFS_SOAP_CLIENT_PFX_PASSPHRASE: "testpfx",
    } as Env)!;
    expect(material.pfx?.equals(CLIENT_PFX)).toBe(true);
    expect(material.passphrase).toBe("testpfx");
    expect(describeTlsMaterial(material)).toContain("PKCS#12");
  });

  it("says so loudly when certificate verification is disabled", () => {
    const material = envTlsMaterial({ ...env, EFS_SOAP_TLS_INSECURE: true } as Env)!;
    expect(material.rejectUnauthorized).toBe(false);
    expect(describeTlsMaterial(material)).toContain("CERTIFICATE VERIFICATION DISABLED");
  });

  it("returns null when nothing is configured (behaviour identical to pre-mTLS)", () => {
    expect(envTlsMaterial(env)).toBeNull();
    expect(describeTlsMaterial(null)).toBe("standard TLS (no client certificate configured)");
  });
});

describe("classifyTlsError — an operator-actionable message for every common failure", () => {
  const cases: [string, unknown, string][] = [
    ["client cert rejected", { code: "EPROTO", message: "write EPROTO ... alert handshake failure" }, "client_cert_rejected"],
    ["cert expired", { code: "CERT_HAS_EXPIRED", message: "certificate has expired" }, "client_cert_expired"],
    ["untrusted server", { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", message: "unable to verify the first certificate" }, "server_cert_untrusted"],
    ["hostname mismatch", { code: "ERR_TLS_CERT_ALTNAME_INVALID", message: "Hostname/IP does not match certificate's altnames" }, "server_hostname_mismatch"],
    ["key/cert mismatch", { message: "error:0B080074:x509 certificate routines:X509_check_private_key:key values mismatch" }, "key_unusable"],
    ["bad passphrase", { message: "error:1C800064:Provider routines::bad decrypt" }, "key_unusable"],
    ["unreachable", { code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, "network"],
  ];
  it.each(cases)("classifies %s", (_label, err, kind) => {
    const failure = classifyTlsError(err);
    expect(failure.kind).toBe(kind);
    expect(failure.message.length).toBeGreaterThan(20); // an actual instruction, not a code
  });

  it("leaves genuinely unknown errors alone so they are not mislabelled", () => {
    expect(classifyTlsError({ message: "something entirely different" }).kind).toBe("unknown");
  });

  it("a real handshake rejection from the live server classifies correctly", async () => {
    // Not a synthetic error object — the actual failure the server produces when we present nothing.
    const failure = await post({ source: "env", ca: CA, rejectUnauthorized: true }).then(
      () => null,
      (e) => classifyTlsError(e),
    );
    expect(failure).not.toBeNull();
    expect(["client_cert_rejected", "network"]).toContain(failure!.kind);
  });
});
