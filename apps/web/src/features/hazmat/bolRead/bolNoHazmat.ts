import { readersAgree, ROW_WITNESS_READERS, type ReadResponse } from "@silvicom/shared";

/**
 * When the read found no hazmat line, whether the screen may say "No hazardous materials on this BOL" — or
 * must say "check the page", and why (the 2026-10-14 external audit's negative-evidence finding; D-DR24's
 * follow-up, DOCUMENT-READER-PLAN §7B).
 *
 * "No hazmat" is the one verdict a reader's miss turns into an under-placarded truck, and it used to rest on
 * the two models alone. Two readers that skip the same small line agree perfectly. So the sentence now needs
 * three independent things, each a doubt when it is missing:
 *
 *   one_reader         both readers read the paper and both read no hazmat line (`hazmat.lines` agrees);
 *   no_page_scan       the OCR engine scanned every read page (no OCR — engine off, failed, a read replayed
 *                      from before rule 6 — is no evidence, never "nothing found");
 *   marks_on_page      neither the OCR nor a born-digital page's text layer found a UN/NA number, an RQ or
 *                      an X in the HM column anywhere (hazmatMarkWitness.ts, the API's scan);
 *   pages_unconfirmed  the paper audit's §172.201(c) page rule passed: every page of the paper is in the read,
 *                      as both readers read its markers (paper_page_complete, D-DR22's bar). A hazmat line on
 *                      a page nobody photographed is the miss no reader can catch.
 *
 * The page rule is read from the audit rather than redone here: one answer to "is every page here".
 */
export type NoHazmatDoubt = "one_reader" | "no_page_scan" | "marks_on_page" | "pages_unconfirmed";

export interface NoHazmatEvidence {
  /** Empty when the screen may say no hazardous materials outright. */
  doubts: NoHazmatDoubt[];
  /** What the page scan found, as it compares them ("UN1993", "RQ", "X"), once each. */
  marks: string[];
  /** The pages the scan's first find is on, per witness, once each. */
  markPages: number[];
}

export function noHazmatEvidence(read: ReadResponse): NoHazmatEvidence {
  const lines = read.evidence.find((e) => e.path === "hazmat.lines");
  const scans = lines?.sources.filter((s) => (ROW_WITNESS_READERS as readonly string[]).includes(s.reader)) ?? [];
  const found = scans.filter((s) => !Array.isArray(s.value) || s.value.length > 0);
  const marks = [...new Set(found.flatMap((s) => (Array.isArray(s.value) ? s.value.map(String) : [])))];
  const markPages = [...new Set(found.flatMap((s) => (s.page === null ? [] : [s.page])))].sort((a, b) => a - b);
  const pages = read.paperAudit?.results.find((r) => r.ruleId === "paper_page_complete");

  const doubts: NoHazmatDoubt[] = [];
  if (!lines || readersAgree(lines) !== true) doubts.push("one_reader");
  if (!scans.some((s) => s.reader === "ocr")) doubts.push("no_page_scan");
  if (found.length > 0) doubts.push("marks_on_page");
  if (pages?.outcome !== "pass") doubts.push("pages_unconfirmed");
  return { doubts, marks, markPages };
}
