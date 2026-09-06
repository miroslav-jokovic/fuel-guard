import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { verifyTelnyxSignature, TELNYX_SIGNATURE_TOLERANCE_SECONDS } from "./telnyxSignature.js";

/**
 * WHY THIS SUITE EXISTS. This function is the only thing standing between a stranger and a driver's
 * consent record. Every case below is a way an attacker (or a misconfiguration) could get a forged
 * `STOP` accepted, and each one asserts the refusal rather than the acceptance — the acceptance is a
 * single test, because "it works" is the cheap half.
 */

// A real Ed25519 keypair, so the test signs the way Telnyx signs rather than asserting on a stub.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_B64 = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");

const NOW = 1_757_000_000;
const BODY = Buffer.from(JSON.stringify({ data: { event_type: "message.received" } }));

const signWith = (timestamp: string, body: Buffer = BODY, key = privateKey) =>
  edSign(null, Buffer.concat([Buffer.from(`${timestamp}|`, "utf8"), body]), key).toString("base64");

describe("verifyTelnyxSignature", () => {
  it("accepts a delivery signed by the account's key", () => {
    const ts = String(NOW);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, signWith(ts), ts, NOW)).toBe(true);
  });

  it("refuses a body edited after signing", () => {
    const ts = String(NOW);
    const sig = signWith(ts);
    const tampered = Buffer.from(JSON.stringify({ data: { event_type: "message.received", evil: 1 } }));
    expect(verifyTelnyxSignature(PUBLIC_B64, tampered, sig, ts, NOW)).toBe(false);
  });

  it("refuses a signature made with a different key", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const ts = String(NOW);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, signWith(ts, BODY, other), ts, NOW)).toBe(false);
  });

  // The replay bound. The timestamp is inside the signed payload, so a captured delivery cannot be
  // re-dated — which is what makes this a real defence rather than a decoration.
  it("refuses a validly signed delivery replayed after the tolerance", () => {
    const ts = String(NOW);
    const sig = signWith(ts);
    const justInside = NOW + TELNYX_SIGNATURE_TOLERANCE_SECONDS;
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, sig, ts, justInside)).toBe(true);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, sig, ts, justInside + 1)).toBe(false);
  });

  it("refuses a timestamp from the future by the same margin", () => {
    const ts = String(NOW);
    const sig = signWith(ts);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, sig, ts, NOW - TELNYX_SIGNATURE_TOLERANCE_SECONDS - 1)).toBe(false);
  });

  // Fail-closed, the rule this file shares with the Samsara receiver: an unverifiable request is
  // refused, and "no key configured" is unverifiable rather than an excuse to skip the check.
  it("fails closed on a missing key, signature or timestamp", () => {
    const ts = String(NOW);
    const sig = signWith(ts);
    expect(verifyTelnyxSignature(undefined, BODY, sig, ts, NOW)).toBe(false);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, null, ts, NOW)).toBe(false);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, sig, null, NOW)).toBe(false);
  });

  it("refuses a malformed key or a non-numeric timestamp rather than throwing", () => {
    const ts = String(NOW);
    const sig = signWith(ts);
    expect(verifyTelnyxSignature("not-base64-32-bytes", BODY, sig, ts, NOW)).toBe(false);
    expect(verifyTelnyxSignature(Buffer.alloc(31).toString("base64"), BODY, sig, ts, NOW)).toBe(false);
    expect(verifyTelnyxSignature(PUBLIC_B64, BODY, sig, "yesterday", NOW)).toBe(false);
  });
});
