import { createHmac, hkdfSync } from "node:crypto";
import type { Env } from "../../../env.js";
import { decodeSecretsKey } from "../../../lib/secretBox.js";

/**
 * The mirror's lookup handle for a card number.
 *
 * Its own module so `efsCardMirror.ts` and `efsCardTombstone.ts` can both key on it without one
 * importing the other — the tombstone sweep is called BY the mirror, so a shared helper living in
 * the mirror would make that a cycle. Nothing else changed: `efsCardMirror.ts` re-exports it, so
 * every existing `from "./efsCardMirror.js"` import still resolves.
 */

/**
 * Deterministic, keyed, org-bound lookup handle for a card number.
 *
 * Keyed rather than a bare digest on purpose: a card number has a known BIN and, once you have a
 * transaction row, a known last four, so an unkeyed SHA-256 is a few million guesses away from the
 * PAN. HKDF gives this a subkey distinct from the sealing key, so the lookup index and the ciphertext
 * do not share a secret. The org id is inside the MAC so the same physical card in two tenants
 * produces two different handles and cannot be correlated across them.
 */
export function cardRefHmac(env: Env, orgId: string, cardNumber: string): string {
  // Strict, shared decoder (audit hardening): the old inline `Buffer.from(raw, includes("-") ? …)`
  // heuristic could silently derive this subkey from a TRUNCATED key — `Buffer.from(x, "hex")` stops
  // at the first non-hex char and returns a short buffer with no error, collapsing the keyed lookup
  // handle toward the guessable bare-digest case. decodeSecretsKey asserts exactly 32 bytes.
  const master = decodeSecretsKey(env);
  const subkey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "efs-card-ref", 32));
  return createHmac("sha256", subkey).update(`${orgId}:${cardNumber}`).digest("hex");
}
