import { createHash } from "node:crypto";
import { checkOutboundUrl, type OutboundDnsLookup } from "../../../lib/ssrfGuard.js";

/**
 * Fetch one page a recruiter saved to the swipe file, as text the Researcher may read (ADS-PLATFORM-V2-PLAN V2r,
 * D-AD36). Code fetches; the model never does, and has no tool to.
 *
 * ── THE FETCH IS HELD TO PUBLIC HTTPS, AT EVERY HOP ────────────────────────────────────────────────────
 * A recruiter types the address, so it is a tenant-supplied URL fetched from inside our network — the case
 * `lib/ssrfGuard.ts` was written for (audit 2026-08-09 §3.8). Every hop is checked by `checkOutboundUrl`: https
 * only, no embedded credentials, and every address the host resolves to public. Redirects are followed by hand
 * (`redirect: "manual"`), at most `MAX_REDIRECTS`, each new address checked the same way before it is asked, so a
 * public page cannot bounce the request to 169.254.169.254. The residual DNS-rebinding window the guard names is
 * the same here and is accepted for the same reason.
 *
 * ── WHAT IS READ, AND HOW MUCH ─────────────────────────────────────────────────────────────────────────
 * HTML or plain text only; at most `MAX_BYTES` read off the wire, whatever the server says its length is; at
 * most `TIMEOUT_MS` for the whole exchange. The text handed on is `pageText`'s: scripts, styles and markup gone,
 * entities decoded, and — because job pages commonly carry the posting as schema.org `JobPosting` data inside a
 * script tag, which a page drawn by script may hold and show nowhere else — the text of any such posting kept.
 *
 * ── A PAGE DRAWN BY SCRIPT ─────────────────────────────────────────────────────────────────────────────
 * Many career sites send an empty shell and draw the posting in the browser. We do not run a browser: such a page
 * yields too little text, and the entry says so (`too_little_text`) rather than reading the shell. A recruiter can
 * then save a picture of the posting instead.
 */

export const MAX_BYTES = 2_000_000;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
/** Fewer characters than this after extraction is a shell, not a page. */
export const MIN_TEXT = 200;
/** The most handed to the model: a job page's substance is far shorter, and a longer page is mostly navigation. */
export const MAX_TEXT = 60_000;

export type PageFetchRefusal = "blocked" | "http_error" | "not_html" | "too_large" | "too_many_redirects" | "timeout" | "unreachable" | "too_little_text";

export type PageFetchOutcome =
  | { ok: true; url: string; text: string; sha256: string }
  | { ok: false; refusal: PageFetchRefusal; detail: string };

export interface PageFetchDeps {
  fetch?: typeof fetch;
  lookup?: OutboundDnsLookup;
}

/** What the office is told, per refusal. Never the resolved address: that would describe our network. */
export const PAGE_FETCH_WORDS: Record<PageFetchRefusal, string> = {
  blocked: "This address cannot be read from our servers. Check that it is a public https page.",
  http_error: "The site answered with an error.",
  not_html: "This address is not a web page (it is a file or another kind of content).",
  too_large: "The page is larger than 2 MB.",
  too_many_redirects: "The address redirects too many times.",
  timeout: "The site did not answer within 10 seconds.",
  unreachable: "The site could not be reached.",
  too_little_text: "The page holds almost no text when read without a browser (it is drawn by script). Save a picture of the posting instead.",
};

export async function fetchPage(deps: PageFetchDeps, raw: string): Promise<PageFetchOutcome> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await checkOutboundUrl(target, { lookup: deps.lookup });
    if (!check.ok) return { ok: false, refusal: "blocked", detail: check.detail };
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(check.url, {
        redirect: "manual", signal: deadline,
        headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "Silvicom360-Researcher/1.0" },
      });
    } catch (e) {
      const timedOut = deadline.aborted || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
      return { ok: false, refusal: timedOut ? "timeout" : "unreachable", detail: e instanceof Error ? e.message : String(e) };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, refusal: "http_error", detail: `HTTP ${res.status} with no Location` };
      target = new URL(location, check.url).toString();
      continue;
    }
    if (!res.ok) return { ok: false, refusal: "http_error", detail: `HTTP ${res.status}` };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)\b/.test(type)) return { ok: false, refusal: "not_html", detail: type || "no content-type" };
    const body = await readCapped(res, deadline);
    if (body.kind !== "ok") return { ok: false, refusal: body.kind, detail: body.kind === "too_large" ? `over ${MAX_BYTES} bytes` : "the read timed out" };
    const text = type.startsWith("text/plain") ? tidy(body.text) : pageText(body.text);
    if (text.length < MIN_TEXT) return { ok: false, refusal: "too_little_text", detail: `${text.length} characters` };
    const kept = text.slice(0, MAX_TEXT);
    return { ok: true, url: check.url, text: kept, sha256: createHash("sha256").update(kept).digest("hex") };
  }
  return { ok: false, refusal: "too_many_redirects", detail: `more than ${MAX_REDIRECTS}` };
}

async function readCapped(res: Response, deadline: AbortSignal): Promise<{ kind: "ok"; text: string } | { kind: "too_large" } | { kind: "timeout" }> {
  if (!res.body) return { kind: "ok", text: "" };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return { kind: "too_large" }; }
      chunks.push(value);
    }
  } catch {
    return deadline.aborted ? { kind: "timeout" } : { kind: "ok", text: Buffer.concat(chunks).toString("utf8") };
  }
  return { kind: "ok", text: Buffer.concat(chunks).toString("utf8") };
}

// ── HTML → text ───────────────────────────────────────────────────────────────────────────────────────
const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|main|aside|nav|dd|dt|dl|blockquote|pre|hr|form|fieldset|figure|figcaption)\b[^>]*>/gi;
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·", dollar: "$", cent: "¢", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

const tidy = (text: string) => text.replace(/[ \t\f\v\u00a0]+/g, " ").replace(/ *\n[ \n]*/g, "\n").trim();

/** The readable text of an HTML page, with any schema.org JobPosting it embeds written out first. */
export function pageText(html: string): string {
  const postings = jobPostings(html);
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidy([...postings, decodeEntities(body)].join("\n"));
}

/** The text of each schema.org JobPosting in the page's JSON-LD: title, pay, place, and its description as text. */
export function jobPostings(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]!.trim()); } catch { continue; }
    for (const node of flatten(data)) {
      const type = node["@type"];
      if (type !== "JobPosting" && !(Array.isArray(type) && type.includes("JobPosting"))) continue;
      const lines: string[] = [];
      if (typeof node.title === "string") lines.push(node.title);
      const pay = salaryText(node.baseSalary);
      if (pay) lines.push(pay);
      if (typeof node.employmentType === "string") lines.push(node.employmentType);
      if (typeof node.description === "string") lines.push(pageText(decodeEntities(node.description)));
      if (lines.length > 0) out.push(lines.join("\n"));
    }
  }
  return out;
}

function flatten(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.flatMap(flatten);
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    return [o, ...(Array.isArray(o["@graph"]) ? flatten(o["@graph"]) : [])];
  }
  return [];
}

/** schema.org MonetaryAmount → "Pay: 0.6 to 0.68 USD per MILE", in the page's own numbers and unit words. */
function salaryText(salary: unknown): string | null {
  if (!salary || typeof salary !== "object") return null;
  const s = salary as { currency?: unknown; value?: unknown };
  const v = (s.value && typeof s.value === "object" ? s.value : {}) as { value?: unknown; minValue?: unknown; maxValue?: unknown; unitText?: unknown };
  const num = (x: unknown) => (typeof x === "number" || (typeof x === "string" && x.trim() !== "") ? String(x) : null);
  const amount = num(v.value) ?? [num(v.minValue), num(v.maxValue)].filter(Boolean).join(" to ");
  if (!amount) return null;
  return `Pay: ${amount}${typeof s.currency === "string" ? ` ${s.currency}` : ""}${typeof v.unitText === "string" ? ` per ${v.unitText}` : ""}`;
}
