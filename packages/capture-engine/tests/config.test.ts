import { describe, expect, it } from "vitest";
import {
  BUNDLED_DEFAULT_CONFIG,
  canonicalStringify,
  compareConfigVersion,
  loadConfig,
  parseConfigVersion,
  validateConfig,
  type RemoteConfigEnvelope,
  type SignatureVerifier,
} from "../src/config.js";

const accept: SignatureVerifier = { verify: () => true };
const reject: SignatureVerifier = { verify: () => false };

function remote(version: string): RemoteConfigEnvelope {
  return { config: { ...BUNDLED_DEFAULT_CONFIG, configVersion: version }, signatureBase64: "sig" };
}

describe("config version parsing + ordering", () => {
  it("parses capture-YYYY.MM.N and rejects junk", () => {
    expect(parseConfigVersion("capture-2026.08.0")).toEqual({ year: 2026, month: 8, seq: 0 });
    expect(parseConfigVersion("capture-2026.13.0")).toBeNull();
    expect(parseConfigVersion("nope")).toBeNull();
  });
  it("orders by year, month, seq", () => {
    expect(compareConfigVersion("capture-2026.08.0", "capture-2026.08.1")).toBe(-1);
    expect(compareConfigVersion("capture-2026.09.0", "capture-2026.08.9")).toBe(1);
    expect(compareConfigVersion("capture-2026.08.0", "capture-2026.08.0")).toBe(0);
  });
});

describe("validateConfig", () => {
  it("accepts the bundled default and rejects malformed input", () => {
    expect(validateConfig(BUNDLED_DEFAULT_CONFIG)).not.toBeNull();
    expect(validateConfig({ configVersion: "capture-2026.08.0" })).toBeNull();
    expect(validateConfig(null)).toBeNull();
  });
});

describe("canonicalStringify", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("loadConfig — never weakens the gate (§8)", () => {
  it("uses the bundled default when there is no remote", async () => {
    const r = await loadConfig({ verifier: accept });
    expect(r.source).toBe("bundled");
    expect(r.config.configVersion).toBe("capture-2026.08.0");
  });
  it("rejects a remote with a bad signature, keeping last-known-good", async () => {
    const r = await loadConfig({ lastKnownGood: BUNDLED_DEFAULT_CONFIG, remote: remote("capture-2026.09.0"), verifier: reject });
    expect(r.source).toBe("last_known_good");
    expect(r.rejectedRemoteReason).toBe("bad_signature");
  });
  it("rejects a non-monotonic (older) remote even with a good signature", async () => {
    const base = { ...BUNDLED_DEFAULT_CONFIG, configVersion: "capture-2026.09.0" };
    const r = await loadConfig({ lastKnownGood: base, remote: remote("capture-2026.08.0"), verifier: accept });
    expect(r.source).toBe("last_known_good");
    expect(r.rejectedRemoteReason).toBe("not_monotonic");
  });
  it("accepts a newer, well-formed, signed remote", async () => {
    const r = await loadConfig({ lastKnownGood: BUNDLED_DEFAULT_CONFIG, remote: remote("capture-2026.09.0"), verifier: accept });
    expect(r.source).toBe("remote");
    expect(r.config.configVersion).toBe("capture-2026.09.0");
  });
});
