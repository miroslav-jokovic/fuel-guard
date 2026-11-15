/**
 * The org's email-domain allowlist: which addresses may be invited to, and may accept an invite into, an
 * organisation (audit M2). Lived in `auth.ts` until 2026-11-15, and moved out whole when that file reached its
 * 500-line budget — it reads no role, claim or section, so it was only ever a neighbour there.
 */

/** Lower-cased domain part of an email, or null if malformed. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * True iff the email's domain is in the org's allowlist (case-insensitive).
 * An empty or absent allowlist means no domain restriction — all emails are allowed.
 * Enforced at BOTH invite creation and invite acceptance (audit M2).
 */
export function isEmailDomainAllowed(email: string, allowedDomains: readonly string[] | null | undefined): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const domain = emailDomain(email);
  if (!domain) return false;
  return allowedDomains.some((d) => d.trim().toLowerCase() === domain);
}
