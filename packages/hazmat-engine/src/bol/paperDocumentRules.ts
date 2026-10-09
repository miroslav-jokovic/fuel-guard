/**
 * The document-level rules of the printed-paper audit: the §172.204 certification and §172.201(c)'s page
 * numbering (the §172.604 emergency number, which needs every line's context, is paperErPhone.ts). One
 * answer per paper, `lineIndex: null`. Quotes are eCFR's text of 2026-10-09.
 */
import type { PaperFieldStates, PaperRuleResult, PrintedPaper, ResolvedPaper } from "./paperTypes.js";
import { make, unconfirmed } from "./paperSupport.js";

function gate(r: ReturnType<typeof make>, states: PaperFieldStates, paths: readonly string[]): PaperRuleResult | null {
  const open = unconfirmed(states, paths);
  return open.length ? r("cannot_tell", "field_unconfirmed", { unconfirmed: open }) : null;
}

/**
 * paper_certification — §172.204: the shipper's certification is on the paper (presence only — whose
 * signature it is cannot be read). §172.204(b)(1): "Except for a hazardous waste, no certification is
 * required … (i) In a cargo tank supplied by the carrier, or (ii) By the shipper as a private carrier except
 * for a hazardous material that is to be reshipped or transferred from one carrier to another." An absent
 * certification fails only when the caller says no exception applies; the caller derives that answer with
 * `certificationExemptionFrom` (owner ruling Q-DR16), never by hand.
 */
export function paperCertification(printed: PrintedPaper, resolved: ResolvedPaper, states: PaperFieldStates): PaperRuleResult {
  const r = make("paper_certification", null);
  const g = gate(r, states, ["hazmat.shipperCertification"]);
  if (g) return g;
  const seen = printed.hazmat.shipperCertification;
  if (seen === true) return r("pass", "present");
  if (seen == null) return r("cannot_tell", "not_seen");
  const exempt = resolved.certificationExempt ?? null;
  if (exempt === true) return r("pass", "exempt");
  if (exempt === false) return r("fail", "missing");
  return r("cannot_tell", "exception_may_apply");
}

/** "Page 2 of 3" → { page: 2, of: 3 }; "3" → { page: 3, of: null }; "" → { page: null, of: null }. */
function parseMarker(marker: string): { page: number | null; of: number | null } {
  const m = /(\d+)(?:\s*(?:of|\/)\s*(\d+))?/i.exec(marker);
  return m ? { page: Number(m[1]), of: m[2] != null ? Number(m[2]) : null } : { page: null, of: null };
}

/**
 * paper_page_complete — §172.201(c): "A shipping paper may consist of more than one page, if each page is
 * consecutively numbered and the first page bears a notation specifying the total number of pages included
 * in the shipping paper. For example, "Page 1 of 4 pages."" Three things, each checked when the caller
 * supplies what it needs: the page count (images, or the per-image markers), every image numbered, and the
 * total on page 1. A paper is called single-page only when it is KNOWN to be one image; a multi-image paper
 * that prints no total fails, because (c) is the only footing on which a paper may run to a second page.
 */
export function paperPageComplete(printed: PrintedPaper, resolved: ResolvedPaper, states: PaperFieldStates): PaperRuleResult {
  const r = make("paper_page_complete", null);
  const g = gate(r, states, ["identity.pageOf", "identity.printedPageNumbers"]);
  if (g) return g;
  const markers = printed.identity.printedPageNumbers ?? null;
  const parsed = markers?.map(parseMarker) ?? null;
  const of = printed.identity.pageOf?.of ?? parsed?.find((p) => p.of != null)?.of ?? null;
  const seen = parsed ? parsed.map((p) => p.page).filter((n): n is number => n != null) : (resolved.pagesPresent ?? null);
  const images = resolved.imageCount ?? markers?.length ?? null;

  if (of == null) {
    if (images == null) return r("cannot_tell", "page_count_unknown");
    return images <= 1 ? r("pass", "single_page", { pages: 1 }) : r("fail", "multi_page_unnumbered", { pages: images });
  }
  // "Page 1 of 1" on one image (or on an uncounted paper) is a single page by its own notation.
  if (of <= 1 && (images ?? 1) <= 1) return r("pass", "single_page", { pages: 1 });
  const total = of;
  if (seen == null) return r("cannot_tell", "pages_not_counted", { of: total });
  const unnumbered = parsed ? parsed.filter((p) => p.page == null).length : 0;
  if (unnumbered) return r("fail", "page_not_numbered", { of: total, unnumberedImages: unnumbered });
  const pagesBeyond = [...new Set(seen.filter((n) => n < 1 || n > total))].sort((a, b) => a - b);
  if (pagesBeyond.length) return r("fail", "numbering_inconsistent", { of: total, pagesBeyond });
  const missingPages: number[] = [];
  for (let n = 1; n <= total; n++) if (!seen.includes(n)) missingPages.push(n);
  if (missingPages.length) return r("fail", "pages_missing", { of: total, missingPages });
  // "the first page bears a notation specifying the total": read from page 1's own marker when there is one.
  const first = parsed?.find((p) => p.page === 1) ?? null;
  if (first && first.of == null) return r("fail", "total_not_on_first_page", { of: total });
  return r("pass", "all_pages", { of: total, firstPageTotalVerified: first != null || printed.identity.pageOf?.page === 1 });
}
