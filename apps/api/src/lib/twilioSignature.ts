import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio's request signature (A11b) — the thing that makes an inbound `STOP` believable.
 *
 * ── THE ALGORITHM, AS TWILIO DOCUMENTS IT ─────────────────────────────────────────────────────
 * Take the full URL the request was sent to, append every POST parameter sorted by name as
 * `name + value` with no separators, HMAC-SHA1 the result with the account's auth token, and
 * base64 the digest. SHA-1 is Twilio's choice and not ours; it is used here as a MAC with a secret
 * key, where its collision weakness does not apply.
 *
 * ── WHY THIS MATTERS MORE THAN THE USUAL WEBHOOK ──────────────────────────────────────────────
 * A forged inbound message could revoke a real driver's consent — annoying. The dangerous direction
 * is the other one: anything that let an attacker suppress or forge our *belief* about opt-outs would
 * leave the carrier texting somebody who had said stop, at $500 to $1,500 a message. So an
 * unverifiable request is refused outright rather than processed optimistically, and a missing auth
 * token means every request is unverifiable — never "skip the check in development".
 */
export function verifyTwilioSignature(
  authToken: string | undefined,
  url: string,
  params: Record<string, unknown>,
  signature: string | null | undefined,
): boolean {
  // No token configured means nothing can be verified, so nothing is accepted. The alternative — a
  // dev-mode bypass — is a production bypass one misconfiguration later.
  if (!authToken || !signature) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] ?? ""), url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // Constant-time, and length-checked first because `timingSafeEqual` throws on a mismatch — the
  // `safeEqual` rule the recruiting plan states for every webhook receiver.
  return a.length === b.length && timingSafeEqual(a, b);
}
