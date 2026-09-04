import { createHash, randomBytes } from "node:crypto";

/**
 * A credential that travels in an email link, and the form it takes at rest.
 *
 * ── WHY THE INVITATION LINK IS OURS AND NOT GOTRUE'S (2026-09-04) ───────────────────────────────
 * Until this file, an office invitation was delivered as a Supabase one-time token: `generateLink`
 * minted it, the email carried it, and `verifyOtp` in the browser spent it. Three properties of that
 * token, none of them ours to change, each cost a lost invitation on production:
 *
 *   · it is spent by whoever opens it first — and the recipient's mail security opens every link
 *     within a minute of delivery (`docs/EMAIL-LINK-DELIVERY.md`);
 *   · it lives for the project's OTP expiry, ONE HOUR by default, while the email beside it said
 *     seven days and the `invites` row said seven days — measured 2026-09-03: an invitation sent at
 *     17:37 UTC with its token still unspent the next morning, and "expired" on the click;
 *   · every `generateLink` for an address overwrites the previous token, so "send it again" killed
 *     the email already in the inbox and left two identical-looking messages, one of them dead.
 *
 * So the link now carries the token this module mints. `invites.token` holds its SHA-256, the row's
 * own `expires_at` is the expiry the email promises, revoke and resend do exactly what they say, and
 * nothing in GoTrue is touched until a person submits a password. The same shape 0220 chose for the
 * driver application link, for the same reason: a database leak yields hashes, not working links.
 */
export interface MintedLinkToken {
  /** What goes in the link. Never stored, never logged. */
  token: string;
  /** What goes in the table. */
  hash: string;
}

/** 256 bits, URL-safe. Unguessable at any rate a limiter would let through. */
export function mintLinkToken(): MintedLinkToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashLinkToken(token) };
}

export const hashLinkToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");
