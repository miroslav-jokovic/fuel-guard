/**
 * The Pilot daily price email → the one link that downloads the quote (PILOT-PRICE-MAIL-PLAN §2).
 *
 * Since 2026-11-11 Pilot no longer attaches the "Better Of" report; the email carries a "View Price Quote"
 * link valid for 48 hours. What arrives in the mailbox is that link wrapped twice, measured on the 11/19
 * message (2026-11-18):
 *
 *   https://urldefense.proofpoint.com/v2/url?u=<encoded>&…      Proofpoint URL Defense (the mail gateway)
 *     → https://<id>.r.us-east-1.awstrack.me/L0/<encoded>/1/…   Amazon SES click tracking (Pilot's sender)
 *       → https://docgenapex.apex.pilotcloud.net:443/…/validate?document=<guid>&hash=…
 *
 * The email also links Pilot's customer portal, which is not the quote. So every href is unwrapped and only
 * a link whose host is Pilot's document service (`*.pilotcloud.net`, https) is kept.
 *
 * ── WHY UNWRAP INSTEAD OF FOLLOWING THE WRAPPERS ─────────────────────────────────────────────────────────
 * Requesting the Proofpoint link would make our server a "click" through two third parties on every run,
 * and would put the decision about which host we finally talk to in their hands. Unwrapping is string work:
 * the only network request we make goes to a host we have checked (pilotQuoteDownload.ts checks every hop).
 *
 * Proofpoint v2 encoding: in the `u` parameter `-` stands for `%` and `_` for `/`; after that substitution it
 * is percent-encoded. SES: the target is the percent-encoded first path segment after `/L0/`. A wrapper this
 * does not recognise (Proofpoint v3 `urldefense.com/v3/__…__`, for one) leaves the href as it is, finds no
 * Pilot host, and the message is recorded as `no_link` with its subject — visible, not silently skipped.
 */

/** Pilot's document service. Anything else in the email is not the quote. */
export const PILOT_DOC_HOST = /(^|\.)pilotcloud\.net$/i;

/** Wrapper layers peeled at most; the measured message has two. */
const MAX_LAYERS = 4;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** HTML attribute text → its value (`&amp;` and numeric references; that is all Outlook writes in an href). */
export function decodeHtmlAttr(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[ref.toLowerCase()] ?? whole;
  });
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Peel one wrapper, or null when `url` is not a wrapper we know. */
function peel(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if ((host === "urldefense.proofpoint.com" || host === "urldefense.com") && url.pathname === "/v2/url") {
    const u = url.searchParams.get("u");
    return u ? safeDecode(u.replace(/-/g, "%").replace(/_/g, "/")) : null;
  }
  if (host.endsWith(".awstrack.me")) {
    const m = /^\/L0\/([^/]+)\//.exec(url.pathname);
    return m ? safeDecode(m[1]!) : null;
  }
  return null;
}

/** An href as written in the email → the address it finally points at (wrappers removed). */
export function unwrapLink(href: string): string {
  let current = decodeHtmlAttr(href.trim());
  for (let i = 0; i < MAX_LAYERS; i++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return current;
    }
    const inner = peel(url);
    if (inner == null) return current;
    current = inner;
  }
  return current;
}

/** True for an https address on Pilot's document service. */
export function isPilotDocUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && PILOT_DOC_HOST.test(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** The quote link in an email body, unwrapped, or null when the email carries none. */
export function findPilotQuoteLink(body: string): string | null {
  for (const m of body.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const target = unwrapLink(m[1] ?? m[2] ?? "");
    if (isPilotDocUrl(target)) return target;
  }
  return null;
}
