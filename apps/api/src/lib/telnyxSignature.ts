import { createPublicKey, verify } from "node:crypto";

/**
 * Telnyx's webhook signature (A11b) — the thing that makes an inbound `STOP` believable.
 *
 * ── THE ALGORITHM, AS TELNYX DOCUMENTS IT ─────────────────────────────────────────────────────
 * Sign `<telnyx-timestamp>|<raw request body>` with Ed25519 and send the signature base64 in
 * `telnyx-signature-ed25519`. Verification uses the account's PUBLIC key from the portal, so unlike
 * an HMAC scheme the receiver holds nothing that could forge a message — losing `TELNYX_PUBLIC_KEY`
 * leaks no ability to send.
 *
 * ⚠ THE BODY MUST BE THE RAW BYTES. Re-serialising the parsed JSON changes key order and whitespace
 * and produces a different signature over identical data — a failure that looks exactly like an
 * attack. `app.ts` captures `rawBody` in the `express.json` verify hook for precisely this.
 *
 * ── WHY THIS MATTERS MORE THAN THE USUAL WEBHOOK ──────────────────────────────────────────────
 * A forged inbound message could revoke a real driver's consent — annoying. The dangerous direction
 * is the other one: anything that let an attacker suppress or forge our *belief* about opt-outs would
 * leave the carrier texting somebody who had said stop, at $500 to $1,500 a message. So an
 * unverifiable request is refused outright rather than processed optimistically, and a missing public
 * key means every request is unverifiable — never "skip the check in development".
 *
 * ── AND WHY THE TIMESTAMP IS CHECKED, WHICH THE TWILIO VERSION COULD NOT DO ───────────────────
 * The timestamp is INSIDE the signed payload, so it cannot be edited without breaking the signature.
 * That makes it a replay bound rather than a decoration: a valid capture of a real `STOP` replayed
 * days later is refused. Twilio's scheme signs the URL and parameters with no time component, so the
 * receiver it replaced had no way to tell a replay from the original.
 */

/** How stale a signed delivery may be. Telnyx's own guidance; generous enough for a retry storm. */
export const TELNYX_SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyTelnyxSignature(
  publicKeyBase64: string | undefined,
  rawBody: Buffer,
  signatureBase64: string | null | undefined,
  timestamp: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  // Nothing configured means nothing can be verified, so nothing is accepted. The alternative — a
  // dev-mode bypass — is a production bypass one misconfiguration later.
  if (!publicKeyBase64 || !signatureBase64 || !timestamp) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  // Both directions: a future timestamp is as much a sign of a forged replay as an ancient one.
  if (Math.abs(nowSeconds - sentAt) > TELNYX_SIGNATURE_TOLERANCE_SECONDS) return false;

  try {
    const raw = Buffer.from(publicKeyBase64, "base64");
    // Ed25519 keys are exactly 32 bytes. Node's SPKI parser accepts other things and would fail
    // later with a less obvious error, so the length is the first thing checked.
    if (raw.length !== 32) return false;
    // Node has no "raw Ed25519 public key" import, so wrap it in the fixed 12-byte SPKI prefix for
    // id-Ed25519 (RFC 8410 §4) — a constant header, not a computation.
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      raw,
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });

    const signed = Buffer.concat([Buffer.from(`${timestamp}|`, "utf8"), rawBody]);
    // Ed25519 takes `null` as the digest algorithm — the scheme hashes internally.
    return verify(null, signed, key, Buffer.from(signatureBase64, "base64"));
  } catch {
    // A malformed key or signature is an unverifiable request, which is a refusal, not a crash.
    return false;
  }
}
