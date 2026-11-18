import { isPilotDocUrl } from "./pilotQuoteLink.js";

/**
 * Download one Pilot price quote from its emailed link (PILOT-PRICE-MAIL-PLAN §2). Measured 2026-11-18:
 *
 *   live link     docgenapex.apex.pilotcloud.net/…/validate → 302 → pfj-apex-docgen-documents-prod-us-east-1
 *                 .s3.us-east-1.amazonaws.com/pq-<guid>-MMDDYYYY.xlsx (presigned, no login) → 200, ~90 KB xlsx
 *   expired link  the same validate URL → 302 → customerportal.pilotflyingj.com (the portal's sign-in)
 *
 * Redirects are followed BY HAND, one hop at a time, so every host we connect to is checked before we connect:
 * Pilot's document service, or Pilot's own document bucket on S3. A redirect anywhere else is refused, not
 * followed. These are fixed public names we chose, never a host the email chooses, so the address-range checks
 * of `lib/ssrfGuard.ts` (written for a URL a TENANT types) add nothing here; the allowlist is the stronger rule.
 */

/** Pilot's document bucket(s): `pfj-…` buckets on S3, any region, virtual-hosted style. */
const PILOT_S3_HOST = /^pfj-[a-z0-9-]+\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$/i;
/** Where an expired link sends you: the customer portal's sign-in. */
const EXPIRED_HOST = /(^|\.)customerportal\.pilotflyingj\.com$/i;

const MAX_HOPS = 4;
/** The measured file is ~90 KB; ten megabytes is a broken or hostile response, not a bigger quote. */
export const MAX_QUOTE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export type QuoteDownload =
  | { ok: true; bytes: Buffer; fileName: string }
  | { ok: false; expired: boolean; error: string };

function allowedHop(raw: string): boolean {
  if (isPilotDocUrl(raw)) return true;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && PILOT_S3_HOST.test(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "(not an address)";
  }
}

/** Last path segment — Pilot names the file `pq-<guid>-MMDDYYYY.xlsx`. Kept for the record, never trusted. */
function fileNameOf(raw: string): string {
  try {
    const last = new URL(raw).pathname.split("/").pop() ?? "";
    return decodeURIComponent(last).replace(/[^\w.-]/g, "_").slice(0, 120) || "quote.xlsx";
  } catch {
    return "quote.xlsx";
  }
}

export async function downloadPilotQuote(link: string, fetchImpl: typeof fetch = fetch): Promise<QuoteDownload> {
  if (!isPilotDocUrl(link)) return { ok: false, expired: false, error: `Not a Pilot document link (host ${hostOf(link)})` };
  let url = link;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, expired: false, error: `Pilot answered ${res.status} with no Location` };
      const next = new URL(location, url).toString();
      if (EXPIRED_HOST.test(hostOf(next))) {
        return { ok: false, expired: true, error: "The link has expired — Pilot sent it to the customer portal's sign-in" };
      }
      if (!allowedHop(next)) return { ok: false, expired: false, error: `Refused a redirect to ${hostOf(next)}` };
      url = next;
      continue;
    }
    if (!res.ok) return { ok: false, expired: false, error: `Pilot answered ${res.status} from ${hostOf(url)}` };
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_QUOTE_BYTES) return { ok: false, expired: false, error: `File too large (${declared} bytes)` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_QUOTE_BYTES) return { ok: false, expired: false, error: `File too large (${bytes.length} bytes)` };
    // An .xlsx is a zip ("PK"). Anything else — an HTML error page served as 200 — is not a quote.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return { ok: false, expired: false, error: `Not a spreadsheet (${res.headers.get("content-type") ?? "no type"}, ${bytes.length} bytes)` };
    }
    return { ok: true, bytes, fileName: fileNameOf(url) };
  }
  return { ok: false, expired: false, error: `More than ${MAX_HOPS} redirects` };
}
