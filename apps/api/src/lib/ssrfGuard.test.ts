import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import {
  BlockedEndpointError,
  allowPrivateEndpoints,
  assertOutboundUrlAllowed,
  checkOutboundUrl,
  type OutboundDnsLookup,
} from "./ssrfGuard.js";

/**
 * Coverage for audit finding 3.8 (2026-08-09): an org admin could store any URL as the EFS SOAP
 * endpoint and have our servers request it on a schedule. Every case below is a URL a tenant could
 * actually submit to POST /integrations/efs-soap/enable.
 *
 * No test touches the network: IP literals are checked without DNS by design, and the name-based
 * cases inject a resolver.
 */

/** Resolver stub — the only way a hostname gets an address in this file. */
const resolvesTo = (...addresses: string[]): OutboundDnsLookup => {
  return async (_hostname: string) =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

/** Fails the test loudly if the guard tries to resolve when it should not have. */
const neverResolves: OutboundDnsLookup = async (hostname: string) => {
  throw new Error(`DNS lookup must not happen for ${hostname}`);
};

describe("checkOutboundUrl — scheme", () => {
  it("requires https", async () => {
    for (const raw of ["http://efs.example.com/ws", "http://169.254.169.254/latest/meta-data/"]) {
      const result = await checkOutboundUrl(raw, { lookup: neverResolves });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("scheme");
    }
  });

  it("rejects non-HTTP schemes outright rather than trying to fetch them", async () => {
    for (const raw of ["file:///etc/passwd", "gopher://10.0.0.1:70/_data", "ftp://efs.example.com/x"]) {
      const result = await checkOutboundUrl(raw, { lookup: neverResolves });
      expect(result.ok === false && result.reason).toBe("scheme");
    }
  });

  it("rejects a string that is not a URL at all", async () => {
    const result = await checkOutboundUrl("ws.efsllc.com/CardManagementWS", { lookup: neverResolves });
    expect(result.ok === false && result.reason).toBe("malformed");
  });
});

describe("checkOutboundUrl — embedded credentials", () => {
  it("rejects user:pass@ before it ever resolves the host", async () => {
    const result = await checkOutboundUrl("https://user:pass@efs.example.com/ws", { lookup: neverResolves });
    expect(result.ok === false && result.reason).toBe("credentials");
  });

  it("rejects a bare username too", async () => {
    const result = await checkOutboundUrl("https://admin@efs.example.com/ws", { lookup: neverResolves });
    expect(result.ok === false && result.reason).toBe("credentials");
  });
});

describe("checkOutboundUrl — IPv4 literals", () => {
  const blockedLiterals = [
    "https://127.0.0.1/ws",
    "https://127.1.2.3/ws",
    "https://10.0.0.5/ws",
    "https://172.16.0.1/ws",
    "https://172.31.255.254/ws",
    "https://192.168.1.1:8080/ws",
    "https://100.64.0.1/ws",
    "https://0.0.0.0/ws",
    "https://224.0.0.1/ws",
    "https://255.255.255.255/ws",
  ];

  it.each(blockedLiterals)("blocks %s without a DNS lookup", async (raw) => {
    const result = await checkOutboundUrl(raw, { lookup: neverResolves });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("blocked_address");
  });

  it("blocks 169.254.169.254 — the cloud instance metadata service", async () => {
    const result = await checkOutboundUrl("https://169.254.169.254/latest/meta-data/iam/security-credentials/", {
      lookup: neverResolves,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("blocked_address");
    expect(result.ok === false && result.detail).toContain("169.254.0.0/16");
    // The caller is told nothing about what we found.
    expect(result.ok === false && result.message).toBe("That endpoint host is not allowed.");
  });

  it("does not over-block the addresses next to the private ranges", async () => {
    // 172.32/16 and 100.128/9 are public; a sloppy mask would swallow them.
    for (const raw of ["https://172.32.0.1/ws", "https://100.128.0.1/ws", "https://9.255.255.255/ws"]) {
      const result = await checkOutboundUrl(raw, { lookup: neverResolves });
      expect(result.ok).toBe(true);
    }
  });

  it("allows a public IPv4 literal", async () => {
    const result = await checkOutboundUrl("https://93.184.216.34/CardManagementWS", { lookup: neverResolves });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.addresses).toEqual(["93.184.216.34"]);
  });
});

describe("checkOutboundUrl — IPv6 literals", () => {
  it("blocks loopback ::1", async () => {
    const result = await checkOutboundUrl("https://[::1]:8080/ws", { lookup: neverResolves });
    expect(result.ok === false && result.reason).toBe("blocked_address");
    expect(result.ok === false && result.detail).toContain("loopback");
  });

  it("blocks unique-local fc00::/7", async () => {
    for (const raw of ["https://[fd00::1]/ws", "https://[fc00::abcd]/ws"]) {
      const result = await checkOutboundUrl(raw, { lookup: neverResolves });
      expect(result.ok === false && result.reason).toBe("blocked_address");
      expect(result.ok === false && result.detail).toContain("fc00::/7");
    }
  });

  it("blocks link-local fe80::/10 and the unspecified address", async () => {
    for (const raw of ["https://[fe80::1]/ws", "https://[::]/ws"]) {
      const result = await checkOutboundUrl(raw, { lookup: neverResolves });
      expect(result.ok === false && result.reason).toBe("blocked_address");
    }
  });

  it("blocks IPv4-mapped forms of a private address", async () => {
    // WHATWG URL rewrites ::ffff:10.0.0.1 as ::ffff:a00:1 — the guard must see through both.
    for (const raw of ["https://[::ffff:10.0.0.1]/ws", "https://[::ffff:169.254.169.254]/ws", "https://[::ffff:7f00:1]/ws"]) {
      const result = await checkOutboundUrl(raw, { lookup: neverResolves });
      expect(result.ok === false && result.reason).toBe("blocked_address");
      expect(result.ok === false && result.detail).toContain("IPv6-embedded IPv4");
    }
  });

  it("allows a public IPv6 literal", async () => {
    const result = await checkOutboundUrl("https://[2606:2800:220:1:248:1893:25c8:1946]/ws", { lookup: neverResolves });
    expect(result.ok).toBe(true);
  });
});

describe("checkOutboundUrl — DNS", () => {
  it("blocks a public-looking name that resolves into RFC1918 space", async () => {
    const result = await checkOutboundUrl("https://efs.internal.example.com/ws", { lookup: resolvesTo("10.1.2.3") });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("blocked_address");
    expect(result.ok === false && result.detail).toContain("10.1.2.3");
  });

  it("blocks when ANY answer is private, even if another is public (DNS rebinding)", async () => {
    const result = await checkOutboundUrl("https://rebind.example.com/ws", {
      lookup: resolvesTo("93.184.216.34", "169.254.169.254"),
    });
    expect(result.ok === false && result.reason).toBe("blocked_address");
  });

  it("blocks when the name does not resolve, with the SAME caller-facing message as a private hit", async () => {
    const failing: OutboundDnsLookup = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND nope.example.com"), { code: "ENOTFOUND" });
    };
    const missing = await checkOutboundUrl("https://nope.example.com/ws", { lookup: failing });
    const internal = await checkOutboundUrl("https://internal.example.com/ws", { lookup: resolvesTo("10.0.0.1") });
    expect(missing.ok === false && missing.reason).toBe("unresolvable");
    expect(missing.ok === false && missing.message).toBe(internal.ok === false ? internal.message : "");
  });

  it("allows a name that resolves only to public addresses and returns the normalised URL", async () => {
    const result = await checkOutboundUrl("https://ws.efsllc.com/axis2/services/CardManagementWS/", {
      lookup: resolvesTo("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"),
    });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.url).toBe("https://ws.efsllc.com/axis2/services/CardManagementWS/");
    expect(result.ok === true && result.hostname).toBe("ws.efsllc.com");
  });
});

describe("assertOutboundUrlAllowed", () => {
  it("returns the URL to send when the check passes", async () => {
    await expect(
      assertOutboundUrlAllowed("https://ws.efsllc.com/ws", { lookup: resolvesTo("93.184.216.34") }),
    ).resolves.toBe("https://ws.efsllc.com/ws");
  });

  it("throws BlockedEndpointError whose message leaks nothing about the target", async () => {
    const error = await assertOutboundUrlAllowed("https://169.254.169.254/latest/meta-data/", {
      lookup: neverResolves,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedEndpointError);
    const blocked = error as BlockedEndpointError;
    expect(blocked.reason).toBe("blocked_address");
    expect(blocked.message).not.toContain("169.254");
    expect(blocked.detail).toContain("169.254.169.254"); // …but the log line still says exactly what happened
  });
});

describe("the development escape hatch", () => {
  const dev = { NODE_ENV: "development", EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true } as Env;

  it("is off unless explicitly enabled", () => {
    expect(allowPrivateEndpoints({ NODE_ENV: "development" } as Env)).toBe(false);
    expect(allowPrivateEndpoints({ NODE_ENV: "production" } as Env)).toBe(false);
  });

  it("is refused in production — a bypass that ships is not a bypass", () => {
    expect(() =>
      allowPrivateEndpoints({ NODE_ENV: "production", EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true } as Env),
    ).toThrow(/refused in production/);
  });

  it("permits a loopback endpoint outside production", async () => {
    expect(allowPrivateEndpoints(dev)).toBe(true);
    const result = await checkOutboundUrl("https://localhost:8443/CardManagementWS", {
      allowPrivateAddresses: true,
      lookup: neverResolves,
    });
    expect(result.ok).toBe(true);
  });

  it("still enforces https and rejects embedded credentials even when bypassed", async () => {
    const insecure = await checkOutboundUrl("http://localhost:8443/ws", { allowPrivateAddresses: true });
    expect(insecure.ok === false && insecure.reason).toBe("scheme");
    const creds = await checkOutboundUrl("https://u:p@localhost:8443/ws", { allowPrivateAddresses: true });
    expect(creds.ok === false && creds.reason).toBe("credentials");
  });
});
