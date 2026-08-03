import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "../env.js";

/**
 * Sealed secrets — authenticated envelope encryption for secret material we must persist in Postgres.
 *
 * WHY THIS EXISTS
 * Everything secret the platform stored before this (`integration_credentials.samsara_api_token`,
 * `efs_soap_credentials.soap_password`) sits in plaintext columns, protected only by "service role
 * only, no RLS policies". That posture is defensible for a revocable API token. It is NOT defensible
 * for a TLS **private key**: a private key is a long-lived cryptographic identity, it is the thing an
 * auditor asks about first, and a database backup, a logical replica, a `pg_dump` in a support ticket
 * or a read-only analytics grant would all expose it. So the private key is sealed here before it ever
 * reaches a column, and the sealing key lives in the deploy environment — never in the database.
 * Compromising the database alone therefore does not yield a usable client certificate.
 *
 * CONSTRUCTION
 *   AES-256-GCM, 96-bit random IV per seal, 128-bit auth tag, with ADDITIONAL AUTHENTICATED DATA.
 *   Envelope format:  `v1.<key-id>.<iv b64url>.<tag b64url>.<ciphertext b64url>`
 *
 * The AAD binds a ciphertext to WHERE IT LIVES — org id + purpose. Moving a sealed key from one org's
 * row to another's, or from the client-key column into some other column, fails authentication rather
 * than decrypting. That closes the "copy the ciphertext and impersonate another tenant" move, which a
 * plain encrypt-only scheme leaves open.
 *
 * The `<key-id>` is a short fingerprint of the sealing key. It is not secret (it is a truncated hash
 * of a hash), and it exists so a KEK rotation is diagnosable: a row sealed under the previous key
 * reports "sealed with key <a>, this deploy holds key <b>" instead of an opaque "unable to
 * authenticate data".
 *
 * KEY SUPPLY
 *   `SECRETS_ENCRYPTION_KEY` — 32 bytes, supplied as base64 or hex. Generate with:
 *       openssl rand -base64 32
 *   Unset → `isSecretBoxConfigured()` is false and the callers REFUSE to persist secret material
 *   (they do not silently fall back to plaintext). Fail closed, loudly, at the point of write.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretBoxError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "bad_key" | "malformed" | "wrong_key" | "tampered",
  ) {
    super(message);
    this.name = "SecretBoxError";
  }
}

const b64url = (b: Buffer): string => b.toString("base64url");
const unb64url = (s: string): Buffer => Buffer.from(s, "base64url");

/** Decode the configured KEK. Accepts base64 (with or without padding) or hex; must be 32 bytes. */
function keyMaterial(env: Env): Buffer {
  const raw = env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new SecretBoxError(
      "SECRETS_ENCRYPTION_KEY is not set — refusing to store secret material. Generate one with `openssl rand -base64 32`.",
      "not_configured",
    );
  }
  const trimmed = raw.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `SECRETS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${decoded.length}). Use \`openssl rand -base64 32\`.`,
      "bad_key",
    );
  }
  return decoded;
}

/** Is sealing available in this deploy? Callers use this to fail closed BEFORE accepting a secret. */
export function isSecretBoxConfigured(env: Env): boolean {
  try {
    keyMaterial(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Short, non-secret identifier for the configured KEK — `sha256(sha256(key))`, first 8 hex chars.
 * Double-hashed so the stored id is not a direct hash of the key itself. Safe to log and to store
 * next to the ciphertext.
 */
export function sealingKeyId(env: Env): string {
  const inner = createHash("sha256").update(keyMaterial(env)).digest();
  return createHash("sha256").update(inner).digest("hex").slice(0, 8);
}

/**
 * Encrypt `plaintext`, binding it to `aad` (use `secretAad(orgId, purpose)`). The returned string is
 * self-describing and safe to store in a text column.
 */
export function seal(env: Env, plaintext: string, aad: string): string {
  const key = keyMaterial(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, sealingKeyId(env), b64url(iv), b64url(cipher.getAuthTag()), b64url(ct)].join(".");
}

/**
 * Decrypt a sealed value. Throws SecretBoxError — `wrong_key` when the envelope was sealed under a
 * different KEK (rotation / wrong deploy), `tampered` when the ciphertext or its binding was altered.
 * The distinction matters operationally: one is "restore the old key or re-enter the credential", the
 * other is "someone edited the database".
 */
export function open(env: Env, sealed: string, aad: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new SecretBoxError("Sealed value is malformed or not a v1 envelope.", "malformed");
  }
  const [, keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const key = keyMaterial(env);
  const currentId = sealingKeyId(env);
  if (keyId !== currentId) {
    throw new SecretBoxError(
      `Sealed with encryption key '${keyId}' but this deploy holds '${currentId}' — SECRETS_ENCRYPTION_KEY changed. Restore the previous key or re-enter the credential.`,
      "wrong_key",
    );
  }
  const iv = unb64url(ivB64);
  const tag = unb64url(tagB64);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError("Sealed value is malformed (bad IV or tag length).", "malformed");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(unb64url(ctB64)), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError(
      "Sealed value failed authentication — the ciphertext, its org binding, or its purpose was altered.",
      "tampered",
    );
  }
}

/** Canonical AAD. Binds a ciphertext to one org AND one purpose; both are checked on open. */
export function secretAad(orgId: string, purpose: string): string {
  return `fuelguard:${purpose}:${orgId}`;
}

/** Constant-time string compare, for anywhere a secret is compared (never `===`). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
