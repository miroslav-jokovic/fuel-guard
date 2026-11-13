import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isPushServiceEndpoint } from "@silvicom/shared";
import type { Env } from "../../env.js";

/**
 * Web Push, the transport (CHAT-WEB-PUSH-PLAN WP2, D-WP7): encrypt a message to one browser and hand it to
 * that browser's push service. Nothing here knows about chat — `chatPush.ts` decides who and what.
 *
 * Built on `node:crypto` rather than the `web-push` package, on purpose (2026-11-13): the two RFCs are short
 * and exact, their published test vectors pin the encryption byte for byte (`webPush.test.ts`), and adding the
 * package re-resolved unrelated peer dependencies across the workspace lockfile (eslint's parser onto
 * TypeScript 6, a second expo-router snapshot) — a change to the build nobody asked for, to save ~100 lines.
 *
 *   · RFC 8291 — Message Encryption for Web Push: ECDH (P-256) with the browser's key, HKDF-SHA-256 with its
 *     auth secret, AES-128-GCM, one record in the RFC 8188 `aes128gcm` content coding.
 *   · RFC 8292 — VAPID: an ES256-signed JWT naming the push service's origin, 12 hours, and our public key.
 *   · RFC 8030 — the request: `TTL`, `Urgency`, `Topic`; 201 = accepted; 404/410 = the subscription is gone.
 */

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url (what a browser subscribes with). */
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The pair from the environment, or null when push is not configured here. Throws on a pair that does not match. */
export function vapidKeysFrom(env: Pick<Env, "WEB_PUSH_VAPID_PUBLIC_KEY" | "WEB_PUSH_VAPID_PRIVATE_KEY" | "WEB_PUSH_SUBJECT" | "WEB_APP_URL">): VapidKeys | null {
  const pub = env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const priv = env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  // The format is checked here, not in env.ts, so a bad value turns push off instead of stopping the API (envWebPush.ts).
  const b64url = /^[A-Za-z0-9_-]+$/;
  if (!b64url.test(pub) || Buffer.from(pub, "base64url").length !== 65) throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY is not a 65-byte base64url key");
  if (!b64url.test(priv) || Buffer.from(priv, "base64url").length !== 32) throw new Error("WEB_PUSH_VAPID_PRIVATE_KEY is not a 32-byte base64url key");
  // Only an explicit subject is held to Apple's rule; unset, it is WEB_APP_URL, https in every deployment.
  if (env.WEB_PUSH_SUBJECT && !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(env.WEB_PUSH_SUBJECT)) {
    throw new Error("WEB_PUSH_SUBJECT must be mailto: or https:");
  }
  const subject = env.WEB_PUSH_SUBJECT || env.WEB_APP_URL;
  // A public key pasted from another pair would sign nothing any browser accepts, silently: every push would
  // come back 403. Derive it from the private half and compare, so the mistake is loud at the first use.
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(priv, "base64url"));
  if (!ecdh.getPublicKey().equals(Buffer.from(pub, "base64url"))) {
    throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY is not the public half of WEB_PUSH_VAPID_PRIVATE_KEY");
  }
  return { publicKey: pub, privateKey: priv, subject };
}

/** A fresh pair, for `scripts/generateVapidKeys.ts`. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  // A scalar with leading zero bytes can come back shorter than 32 bytes, which `vapidKeysFrom` refuses: draw
  // again rather than hand out a pair the server will not use.
  for (;;) {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const priv = ecdh.getPrivateKey();
    const pub = ecdh.getPublicKey();
    if (priv.length === 32 && pub.length === 65) return { publicKey: pub.toString("base64url"), privateKey: priv.toString("base64url") };
  }
}

// ── RFC 8291 ──────────────────────────────────────────────────────────────────────────────────────
/** One record of 4096 octets: 16 of them are the GCM tag and 1 the padding delimiter. */
const RECORD_SIZE = 4096;
export const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1;

export interface EncryptFixed {
  /** Test vectors only: the application server's ephemeral private key and the salt. */
  asPrivate?: Buffer;
  salt?: Buffer;
}

export function encryptPushMessage(plaintext: Buffer, uaPublic: Buffer, authSecret: Buffer, fixed: EncryptFixed = {}): Buffer {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`push message is ${plaintext.length} bytes; one record holds ${MAX_PLAINTEXT}`);
  const ecdh = createECDH("prime256v1");
  if (fixed.asPrivate) ecdh.setPrivateKey(fixed.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  // IKM = HKDF(salt = auth_secret, ikm = ecdh_secret, info = "WebPush: info" 0x00 ua_public as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const salt = fixed.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // The last (only) record ends with the delimiter 0x02 and no further padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);
  // RFC 8188 header: salt (16) | record size (uint32) | key id length (1) | key id = as_public (65).
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// ── RFC 8292 ──────────────────────────────────────────────────────────────────────────────────────
function signingKey(keys: VapidKeys): KeyObject {
  const pub = Buffer.from(keys.publicKey, "base64url");
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
}

/** `Authorization: vapid t=<jwt>, k=<public key>` for one endpoint. Valid 12 hours (the RFC caps it at 24). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date = new Date()): string {
  const aud = new URL(endpoint).origin;
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: keys.subject })}`;
  const signature = sign("sha256", Buffer.from(input), { key: signingKey(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${signature.toString("base64url")}, k=${keys.publicKey}`;
}

// ── RFC 8030 ──────────────────────────────────────────────────────────────────────────────────────
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOptions {
  /** Seconds the push service keeps it for an offline device. */
  ttl: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** Replaces an undelivered message with the same topic (≤ 32 base64url characters). */
  topic?: string;
}

export type PushOutcome =
  | { kind: "sent" }
  /** The browser dropped the subscription (uninstalled, cleared, permission revoked): stop using it. */
  | { kind: "gone"; status: number }
  | { kind: "failed"; status: number | null; detail: string };

type Fetcher = typeof fetch;

export async function sendPush(
  sub: PushSubscriptionKeys,
  message: string,
  keys: VapidKeys,
  opts: PushOptions,
  fetcher: Fetcher = fetch,
): Promise<PushOutcome> {
  // Checked again here, not only at subscribe: this is the line that makes the request.
  if (!isPushServiceEndpoint(sub.endpoint)) return { kind: "failed", status: null, detail: "not a push service endpoint" };
  if (opts.topic !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) throw new Error("a push topic is 1–32 base64url characters");
  let body: Buffer;
  try {
    body = encryptPushMessage(Buffer.from(message, "utf8"), Buffer.from(sub.p256dh, "base64url"), Buffer.from(sub.auth, "base64url"));
  } catch (e) {
    return { kind: "failed", status: null, detail: `encrypt: ${e instanceof Error ? e.message : String(e)}` };
  }
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(sub.endpoint, keys),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl),
    Urgency: opts.urgency,
  };
  if (opts.topic) headers.Topic = opts.topic;
  try {
    const res = await fetcher(sub.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      // A push service answers; it never redirects. Following one would send the request somewhere the
      // endpoint check never saw.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 200 && res.status < 300) return { kind: "sent" };
    if (res.status === 404 || res.status === 410) return { kind: "gone", status: res.status };
    // 400/401/403 are ours (a bad key or JWT) and must not revoke anybody's device; 413/429/5xx are passing.
    const text = (await res.text().catch(() => "")).slice(0, 200);
    return { kind: "failed", status: res.status, detail: text || res.statusText || "push service refused" };
  } catch (e) {
    return { kind: "failed", status: null, detail: e instanceof Error ? e.message : String(e) };
  }
}
