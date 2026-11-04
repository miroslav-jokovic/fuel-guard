import { createHash } from "node:crypto";
import blocks from "./drugAlcoholPolicyText.json" with { type: "json" };
import type { HandbookBlock } from "../handbook/handbookText.js";
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
 * ── TRANSCRIBED, VERBATIM ─────────────────────────────────────────────────────────────────────
 * The scan has no text to extract, so `drugAlcoholPolicyText.json` was transcribed page by page and the
 * owner proofreads the rendering (§15.2 Q-DAP2). The carrier's typing is KEPT — "Refusal to summit",
 * "the BST shall sign", "EMPLOYEE ADMISSION PROGRAM", "designed by our company" — because the policy is
 * the carrier's legal text (D-PKT11: counsel's work product, never ours to edit); §15.2 lists them for
 * the owner. Only the scan's layout became structure: sections are headings, numbered clauses are items,
 * the columns of signs and symptoms are a grid, the cover's clip-art is dropped, and the per-page
 * "INITIALS" boxes are not drawn (the receipt is the signature on the last page, as §382.601(d) asks).
 */
export const DRUG_ALCOHOL_POLICY_BLOCKS = blocks as readonly HandbookBlock[];

/** Which text a receipt was signed against — a hash of the text, never a hand-set string (HANDBOOK_VERSION's rule). */
export const DRUG_ALCOHOL_POLICY_VERSION = `dap-${createHash("sha256").update(JSON.stringify(DRUG_ALCOHOL_POLICY_BLOCKS)).digest("hex").slice(0, 16)}`;

export const DRUG_ALCOHOL_POLICY_DOCUMENT: FlowedDocument = {
  blocks: DRUG_ALCOHOL_POLICY_BLOCKS,
  name: "Drug and alcohol abuse policy",
  version: DRUG_ALCOHOL_POLICY_VERSION,
};
