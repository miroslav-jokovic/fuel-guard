import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { testEnv } from "../testing/testEnv.js";
import { isSecretBoxConfigured, open, safeEqual, seal, sealingKeyId, SecretBoxError, secretAad } from "./secretBox.js";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const envWith = (key?: string): Env => testEnv({ SECRETS_ENCRYPTION_KEY: key });

const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
const OTHER_ORG = "11111111-2222-3333-4444-555555555555";
const AAD = secretAad(ORG, "efs_soap_client_key.v1");

const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n";

describe("secretBox — configuration", () => {
  it("is unconfigured when no key is set, and reports it rather than throwing", () => {
    expect(isSecretBoxConfigured(envWith(undefined))).toBe(false);
    // Callers check first; going ahead anyway must fail loudly, never silently store plaintext.
    expect(() => seal(envWith(undefined), "x", AAD)).toThrow(SecretBoxError);
    expect(() => seal(envWith(undefined), "x", AAD)).toThrow(/not set — refusing to store/);
  });

  it("accepts base64 or hex, and rejects a key of the wrong size", () => {
    expect(isSecretBoxConfigured(envWith(KEY_A))).toBe(true);
    expect(isSecretBoxConfigured(envWith(randomBytes(32).toString("hex")))).toBe(true);
    expect(isSecretBoxConfigured(envWith(randomBytes(16).toString("base64")))).toBe(false);
    expect(() => seal(envWith(randomBytes(16).toString("base64")), "x", AAD)).toThrow(/exactly 32 bytes/);
  });

  it("tolerates surrounding whitespace (env editors add it)", () => {
    expect(isSecretBoxConfigured(envWith(`  ${KEY_A}\n`))).toBe(true);
    expect(sealingKeyId(envWith(`  ${KEY_A}\n`))).toBe(sealingKeyId(envWith(KEY_A)));
  });
});

describe("secretBox — round trip", () => {
  it("seals and opens", () => {
    const env = envWith(KEY_A);
    const sealed = seal(env, PRIVATE_KEY, AAD);
    expect(sealed).not.toContain("PRIVATE KEY"); // the plaintext must not survive anywhere in it
    expect(open(env, sealed, AAD)).toBe(PRIVATE_KEY);
  });

  it("is non-deterministic — the same plaintext seals differently every time", () => {
    const env = envWith(KEY_A);
    // A deterministic ciphertext would leak "these two orgs installed the same certificate".
    expect(seal(env, PRIVATE_KEY, AAD)).not.toBe(seal(env, PRIVATE_KEY, AAD));
  });

  it("carries a key id so a rotated KEK is diagnosable, not mysterious", () => {
    const sealed = seal(envWith(KEY_A), PRIVATE_KEY, AAD);
    expect(sealed.startsWith(`v1.${sealingKeyId(envWith(KEY_A))}.`)).toBe(true);
    expect(() => open(envWith(KEY_B), sealed, AAD)).toThrow(/SECRETS_ENCRYPTION_KEY changed/);
    try {
      open(envWith(KEY_B), sealed, AAD);
    } catch (e) {
      expect((e as SecretBoxError).code).toBe("wrong_key");
    }
  });

  it("handles multi-KB PEM material and unicode", () => {
    const env = envWith(KEY_A);
    const big = PRIVATE_KEY.repeat(200);
    expect(open(env, seal(env, big, AAD), AAD)).toBe(big);
    expect(open(env, seal(env, "pässwörd — ✓", AAD), AAD)).toBe("pässwörd — ✓");
  });
});

describe("secretBox — the AAD binding is the tenant boundary", () => {
  const env = envWith(KEY_A);

  it("refuses to open a ciphertext lifted into another org's row", () => {
    const sealed = seal(env, PRIVATE_KEY, secretAad(ORG, "efs_soap_client_key.v1"));
    // This is the attack the binding exists for: copy org A's sealed key into org B's row and
    // impersonate them. Without AAD it would decrypt cleanly.
    expect(() => open(env, sealed, secretAad(OTHER_ORG, "efs_soap_client_key.v1"))).toThrow(/failed authentication/);
  });

  it("refuses to open a ciphertext moved to a different purpose", () => {
    const sealed = seal(env, PRIVATE_KEY, secretAad(ORG, "efs_soap_client_key.v1"));
    expect(() => open(env, sealed, secretAad(ORG, "efs_soap_client_key_passphrase.v1"))).toThrow(/failed authentication/);
  });

  it("detects tampering with the ciphertext", () => {
    const sealed = seal(env, PRIVATE_KEY, AAD);
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[4]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    const tampered = [...parts.slice(0, 4), ct.toString("base64url")].join(".");
    expect(() => open(env, tampered, AAD)).toThrow(/failed authentication/);
  });

  it("detects tampering with the auth tag", () => {
    const parts = seal(env, PRIVATE_KEY, AAD).split(".");
    const tag = Buffer.from(parts[3]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    expect(() => open(env, [...parts.slice(0, 3), tag.toString("base64url"), parts[4]!].join("."), AAD)).toThrow(
      /failed authentication/,
    );
  });

  it("rejects malformed envelopes instead of guessing", () => {
    for (const bad of ["", "plaintext", "v1.aaa.bbb", "v2.a.b.c.d", "v1.a.b.c.d"]) {
      expect(() => open(env, bad, AAD)).toThrow(SecretBoxError);
    }
  });
});

describe("safeEqual", () => {
  it("compares without leaking length-independent timing, and is correct", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
