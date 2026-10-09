/**
 * The document-level rules of the printed-paper audit: the §172.604 emergency number, the §172.204
 * certification and §172.201(c)'s page count. One answer per paper, `lineIndex: null`.
 */
import type { PaperFieldStates, PaperRuleResult, PrintedPaper, ResolvedPaper } from "./paperTypes.js";
import { blank, make, unconfirmed } from "./paperSupport.js";

function gate(r: ReturnType<typeof make>, states: PaperFieldStates, path: string): PaperRuleResult | null {
  const open = unconfirmed(states, [path]);
  return open.length ? r("cannot_tell", "field_unconfirmed", { unconfirmed: open }) : null;
}

/**
 * paper_er_phone — §172.604: a 24-hour emergency number, "numeric with area code" (docs/17 A.5). Words in
 * its place — the "call shipper" pattern — or a number too short to carry an area code fail. Whether the
 * line is monitored, and whether a provider's number has the registrant's name beside it, are not
 * visible in a transcribed number and are not claimed.
 */
export function paperErPhone(printed: PrintedPaper, states: PaperFieldStates): PaperRuleResult {
  const r = make("paper_er_phone", null);
  const g = gate(r, states, "hazmat.emergencyPhone");
  if (g) return g;
  const text = printed.hazmat.emergencyPhone;
  if (blank(text)) return r("fail", "missing");
  const shown = text!.trim();
  const digits = shown.replace(/\D/g, "");
  if (digits.length >= 10) return r("pass", "well_formed", { printed: shown, digits });
  if (/[a-z]/i.test(shown)) return r("fail", "not_a_number", { printed: shown, digits });
  return r("fail", "too_short", { printed: shown, digits });
}

/**
 * paper_certification — §172.204: the shipper's certification is on the paper (presence only — whose
 * signature it is cannot be read). docs/17 A.4: §172.204(b) excepts a cargo tank the carrier supplied and
 * a private carrier's own product, so an absent one fails only when the caller says no exception applies.
 */
export function paperCertification(printed: PrintedPaper, resolved: ResolvedPaper, states: PaperFieldStates): PaperRuleResult {
  const r = make("paper_certification", null);
  const g = gate(r, states, "hazmat.shipperCertification");
  if (g) return g;
  const seen = printed.hazmat.shipperCertification;
  if (seen === true) return r("pass", "present");
  if (seen == null) return r("cannot_tell", "not_seen");
  const exempt = resolved.certificationExempt ?? null;
  if (exempt === true) return r("pass", "exempt");
  if (exempt === false) return r("fail", "missing");
  return r("cannot_tell", "exception_may_apply");
}

/**
 * paper_page_complete — §172.201(c): a multi-page paper numbers its pages and the first shows the total
 * ("Page 1 of 4"). With a total printed, every page 1…m must be among the pages the reader saw. docs/17
 * A.8: page count only if multi-page — a paper with no marker has nothing to reconcile.
 */
export function paperPageComplete(printed: PrintedPaper, resolved: ResolvedPaper, states: PaperFieldStates): PaperRuleResult {
  const r = make("paper_page_complete", null);
  const g = gate(r, states, "identity.pageOf");
  if (g) return g;
  const of = printed.identity.pageOf?.of ?? null;
  if (of == null || of <= 1) return r("pass", "single_page");
  const seen = resolved.pagesPresent;
  if (seen == null) return r("cannot_tell", "pages_not_counted", { of });
  const missingPages: number[] = [];
  for (let n = 1; n <= of; n++) if (!seen.includes(n)) missingPages.push(n);
  return missingPages.length ? r("fail", "pages_missing", { of, missingPages }) : r("pass", "all_pages", { of });
}
