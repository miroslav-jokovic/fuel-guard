import { createHash } from "node:crypto";
import blocks from "./drugAlcoholPolicyText.json" with { type: "json" };
import { correctHandbook, type HandbookBlock } from "../handbook/handbookText.js";
import { DRUG_ALCOHOL_POLICY_CORRECTIONS } from "./drugAlcoholPolicyCorrections.js";
import type { FlowedDocument } from "../handbook/handbookPdf.js";

/**
 * The carrier's DRUG AND ALCOHOL ABUSE POLICY, as data (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2, Q-OR7).
 *
 * ── WHY IT IS HERE ────────────────────────────────────────────────────────────────────────────
 * 49 CFR §382.601: the carrier gives each driver its written policy — Part 382's requirements, its own
 * rules, the person who answers questions — and each driver signs that he or she received a copy. Page
 * 28 of the packet is that receipt (`p28`), and until 2026-11-04 the policy it receipted was nowhere in
 * the product. The owner supplied it that day (an 18-page scan, `Drug and alcohol policy.pdf`, sha256
 * 96d8b63f…5a16a, no text layer) and asked for it "as a document in our system … same design and layout
 * as other documents": so it is the handbook's kind of document — the carrier's words as blocks, drawn
 * by the handbook's renderer, signed at the driver's own place, filed on the driver.
 *
 * ── TRANSCRIBED, THEN CORRECTED ON RECORD ────────────────────────────────────────────────────
 * The scan has no text to extract, so `drugAlcoholPolicyText.json` was transcribed page by page, faithfully,
 * typos included — it is the record of what the carrier's paper said. What prints is that text with
 * `DRUG_ALCOHOL_POLICY_CORRECTIONS` applied (owner, 2026-11-04: "correct this … really professional and
 * precise"; D-DAP6), each correction listed and each drafting one explained, none changing a rule. Only the
 * scan's layout became structure: sections are headings, numbered clauses are items, the columns of signs
 * and symptoms are a grid, the cover's clip-art is dropped, and the per-page "INITIALS" boxes are not drawn
 * (the receipt is the signature on the last page, as §382.601(d) asks).
 */

/** The carrier's policy exactly as transcribed from the scan, typos included. */
export const DRUG_ALCOHOL_POLICY_SOURCE_BLOCKS = blocks as readonly HandbookBlock[];

/** What prints, and what is versioned: the transcription with the corrections applied. */
export const DRUG_ALCOHOL_POLICY_BLOCKS: readonly HandbookBlock[] = correctHandbook(
  DRUG_ALCOHOL_POLICY_SOURCE_BLOCKS,
  DRUG_ALCOHOL_POLICY_CORRECTIONS,
);

/** Which text a receipt was signed against — a hash of the text, never a hand-set string (HANDBOOK_VERSION's rule). */
export const DRUG_ALCOHOL_POLICY_VERSION = `dap-${createHash("sha256").update(JSON.stringify(DRUG_ALCOHOL_POLICY_BLOCKS)).digest("hex").slice(0, 16)}`;

export const DRUG_ALCOHOL_POLICY_DOCUMENT: FlowedDocument = {
  blocks: DRUG_ALCOHOL_POLICY_BLOCKS,
  name: "Drug and alcohol abuse policy",
  version: DRUG_ALCOHOL_POLICY_VERSION,
};
