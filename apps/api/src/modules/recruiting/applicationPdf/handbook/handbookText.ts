import { createHash } from "node:crypto";
import blocks from "./handbookText.json" with { type: "json" };

/**
 * The carrier's DRIVER HANDBOOK, as data (HANDBOOK-SIGNING-PLAN.md HB1; D-HB4).
 *
 * ── EXTRACTED, NOT RETYPED ────────────────────────────────────────────────────────────────────
 * `handbookText.json` came out of `docs/Kowlage-Base/DRIVER HANDBOOK.docx` by parsing its
 * `word/document.xml` run by run. ⚠ `handbookText.test.ts` re-reads that file at test time and
 * compares every paragraph, so "we printed the carrier's handbook" is a checkable claim rather than
 * an assurance — `packetStatic.ts`'s discipline, applied to a Word file.
 *
 * ⚠ **The carrier's typing is kept** (D-PKT11: the carrier's text is counsel's work product):
 * `COMPNAY`, `THA`, `TEMINATION`, `FLASIFICATION`, `forgoing`. Only Word's LAYOUT became structure:
 * the runs of spaces that lined up the fines schedule are a table, a signature line's underscores are
 * a signature place, and a run of empty paragraphs is one `gap`.
 *
 * ⚠ JSON beside the renderer, not a `.ts` literal in `@silvicom/shared`, and on purpose: only this
 * module draws the text (the applicant reads the PDF it renders), and a 32 KB literal would be the
 * largest source file in the repository for no reader's benefit.
 */

export interface HandbookRun {
  t: string;
  b?: boolean;
  u?: boolean;
}

export type HandbookField = "name" | "signature" | "date" | "ssn";

export type HandbookBlock =
  /** A paragraph as the carrier set it: runs bold (`b`) or underlined (`u`), centred or not. */
  | { k: "p"; runs: HandbookRun[]; align?: "center"; size?: "title" | "subtitle"; heading?: boolean }
  /** One of the nine numbered fuel rules: a bold head, then its body. Word put a line break between. */
  | { k: "rule"; title: HandbookRun[]; body: HandbookRun[] }
  /** The fines schedule (with the carrier's header) and the inspection bonus (without one). */
  | { k: "table"; head: string[] | null; rows: Array<{ item: string[]; fine: string[] }> }
  /** A signature place, with the carrier's own labels (`HANDBOOK_PLACEMENTS`). */
  | { k: "sign"; id: string; fields: Array<{ field: HandbookField; label: string }> }
  | { k: "gap" }
  /** The carrier began this section on its own sheet. */
  | { k: "page" };

export const HANDBOOK_BLOCKS = blocks as readonly HandbookBlock[];

/**
 * Which text a signature was given against, derived from the text itself.
 *
 * ⚠ A hash, never a hand-set string: a version typed beside the text is a second source of truth, and
 * the first edit to the JSON that forgot to bump it would record new signatures against the old
 * version. 0374 stores it on every mark, so "what did this driver sign" stays answerable after the
 * carrier amends the handbook.
 */
export const HANDBOOK_VERSION = `hb-${createHash("sha256").update(JSON.stringify(HANDBOOK_BLOCKS)).digest("hex").slice(0, 16)}`;
