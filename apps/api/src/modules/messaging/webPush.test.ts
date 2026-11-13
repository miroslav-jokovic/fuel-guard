import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptPushMessage, generateVapidKeys, MAX_PLAINTEXT, sendPush, vapidAuthorization, vapidKeysFrom } from "./webPush.js";

/**
 * The Web Push transport, against the RFCs rather than against itself: RFC 8291's own worked example pins the
 * encryption byte for byte, a browser-side decryption written here from the RFC reads a randomly keyed message
 * back, and the VAPID token verifies with the public key a browser would hold.
 */
const b = (s: string) => Buffer.from(s, "base64url");

// RFC 8291 §5 and Appendix A.
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

/** What the browser does with a message (RFC 8291 §3.4, from its private key), written independently of the encryptor. */
function browserDecrypts(message: Buffer, uaPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = message.subarray(0, 16);
  const idLen = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idLen);
  const ct = message.subarray(21 + idLen);
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(uaPrivate);
  const secret = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  expect(padded.at(-1)).toBe(0x02); // the last record's delimiter
  return padded.subarray(0, padded.length - 1);
}

describe("RFC 8291 message encryption", () => {
  it("reproduces the RFC's worked example exactly: header, then ciphertext, 144 octets", () => {
    const out = encryptPushMessage(b(RFC.plaintext), b(RFC.uaPublic), b(RFC.auth), { asPrivate: b(RFC.asPrivate), salt: b(RFC.salt) });
    expect(out.subarray(0, 86).toString("base64url")).toBe(RFC.header);
    expect(out.subarray(86).toString("base64url")).toBe(RFC.ciphertext);
    // 86 header + 41 plaintext + 1 delimiter + 16 tag. The RFC prints "Content-Length: 145"; its own values make
    // 144, which RFC 8291 erratum 5230 (Martin Thomson, the RFC's author, 2018) gives as the correct figure.
    expect(out.length).toBe(144);
  });

  it("a fresh key and salt every time, and the browser reads it back", () => {
    const text = Buffer.from(JSON.stringify({ web_push: 8030, notification: { title: "Ana Petrović", body: "čćž — 4417?" } }));
    const one = encryptPushMessage(text, b(RFC.uaPublic), b(RFC.auth));
    const two = encryptPushMessage(text, b(RFC.uaPublic), b(RFC.auth));
    expect(one.subarray(0, 16).equals(two.subarray(0, 16))).toBe(false);
    expect(browserDecrypts(one, b(RFC.uaPrivate), b(RFC.auth)).equals(text)).toBe(true);
  });

  it("refuses a message larger than one record rather than sending what a browser cannot read", () => {
    expect(() => encryptPushMessage(Buffer.alloc(MAX_PLAINTEXT + 1), b(RFC.uaPublic), b(RFC.auth))).toThrow(/one record/);
    expect(() => encryptPushMessage(Buffer.alloc(MAX_PLAINTEXT), b(RFC.uaPublic), b(RFC.auth))).not.toThrow();
  });
});

describe("RFC 8292 VAPID", () => {
  const pair = generateVapidKeys();
  const keys = { ...pair, subject: "https://360.silvicominc.com" };

  it("signs a token the push service verifies with the key the browser subscribed with", () => {
    const now = new Date("2026-11-13T15:00:00Z");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m!;
    expect(k).toBe(pair.publicKey);
    expect(JSON.parse(b(h!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b(c!).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: now.getTime() / 1000 + 12 * 3600, sub: keys.subject });
    const pub = b(pair.publicKey);
    const jwk = { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") };
    const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, b(s!));
    expect(ok).toBe(true);
  });

  it("reads the pair from the environment, refuses a public key from another pair, and is off when unset", () => {
    const env = { WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey, WEB_PUSH_SUBJECT: undefined, WEB_APP_URL: "https://360.silvicominc.com" };
    expect(vapidKeysFrom(env)).toEqual({ ...pair, subject: "https://360.silvicominc.com" });
    expect(vapidKeysFrom({ ...env, WEB_PUSH_VAPID_PUBLIC_KEY: undefined })).toBeNull();
    expect(() => vapidKeysFrom({ ...env, WEB_PUSH_VAPID_PUBLIC_KEY: generateVapidKeys().publicKey })).toThrow(/not the public half/);
  });
});

describe("sending (RFC 8030)", () => {
  const keys = { ...generateVapidKeys(), subject: "mailto:it@silvicominc.com" };
  const sub = { endpoint: "https://web.push.apple.com/QGd3Yx", p256dh: RFC.uaPublic, auth: RFC.auth };
  const opts = { ttl: 3600, urgency: "high" as const, topic: "33333333333343338333333333333333" };
  const answer = (status: number, text = "") => vi.fn(async () => new Response(text, { status }));

  it("posts the encrypted message with the headers a push service requires, never following a redirect", async () => {
    const fetcher = answer(201);
    expect(await sendPush(sub, '{"web_push":8030}', keys, opts, fetcher as unknown as typeof fetch)).toEqual({ kind: "sent" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(sub.endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "3600", Urgency: "high", Topic: opts.topic });
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    const sent = Buffer.from(init.body as Uint8Array);
    expect(browserDecrypts(sent, b(RFC.uaPrivate), b(RFC.auth)).toString()).toBe('{"web_push":8030}');
  });

  it("reads 404 and 410 as a device that is gone, and nothing else", async () => {
    expect(await sendPush(sub, "x", keys, opts, answer(410) as unknown as typeof fetch)).toEqual({ kind: "gone", status: 410 });
    expect(await sendPush(sub, "x", keys, opts, answer(404) as unknown as typeof fetch)).toEqual({ kind: "gone", status: 404 });
    // A refused key is OUR fault: revoking every device for it would make each person turn it on again.
    expect(await sendPush(sub, "x", keys, opts, answer(403, "BadJwtToken") as unknown as typeof fetch))
      .toEqual({ kind: "failed", status: 403, detail: "BadJwtToken" });
    expect((await sendPush(sub, "x", keys, opts, answer(429) as unknown as typeof fetch)).kind).toBe("failed");
    const broken = vi.fn(async () => { throw new Error("ECONNRESET"); });
    expect(await sendPush(sub, "x", keys, opts, broken as unknown as typeof fetch)).toEqual({ kind: "failed", status: null, detail: "ECONNRESET" });
  });

  it("never requests an endpoint that is not a push service's, whatever the row says", async () => {
    const fetcher = answer(201);
    const out = await sendPush({ ...sub, endpoint: "https://169.254.169.254/latest" }, "x", keys, opts, fetcher as unknown as typeof fetch);
    expect(out.kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
