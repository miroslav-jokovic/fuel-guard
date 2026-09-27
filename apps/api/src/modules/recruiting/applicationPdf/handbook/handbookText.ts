import { createHash } from "node:crypto";
import blocks from "./handbookText.json" with { type: "json" };
import { HANDBOOK_SPELLING, type HandbookSpelling } from "./handbookSpelling.js";

/**
 * The carrier's DRIVER HANDBOOK, as data (HANDBOOK-SIGNING-PLAN.md HB1; D-HB4).
 *
 * ── EXTRACTED, NOT RETYPED ────────────────────────────────────────────────────────────────────
 * `handbookText.json` came out of `docs/Kowlage-Base/DRIVER HANDBOOK.docx` by parsing its
 * `word/document.xml` run by run. ⚠ `handbookText.test.ts` re-reads that file at test time and
 * compares every paragraph, so "we printed the carrier's handbook" is a checkable claim rather than
 * an assurance — `packetStatic.ts`'s discipline, applied to a Word file.
 *
 * ⚠ **The JSON keeps the carrier's typing; what prints does not** (D-HB6, 2026-09-25). The file is
 * the faithful extraction the test checks against the Word document — `COMPNAY`, `THA`,
 * `TEMINATION`, `FLASIFICATION`, `forgoing` included — and `HANDBOOK_BLOCKS` is that extraction with
 * `HANDBOOK_SPELLING` applied, because the owner has said the handbook was retyped. Only Word's LAYOUT became structure:
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

/** The carrier's handbook exactly as extracted from the Word file, typos included. */
export const HANDBOOK_SOURCE_BLOCKS = blocks as readonly HandbookBlock[];

/**
 * The source with `HANDBOOK_SPELLING` applied, run by run — what prints and what is versioned.
 * ⚠ Throws at import when an entry lands a different number of times than it declares: a typo the
 * register stopped matching must fail the build, not print again.
 */
export function correctHandbook(
  source: readonly HandbookBlock[],
  register: readonly HandbookSpelling[] = HANDBOOK_SPELLING,
): HandbookBlock[] {
  const hits = new Map<HandbookSpelling, number>();
  const fix = (text: string): string => {
    let out = text;
    for (const e of register) {
      const parts = out.split(e.wrong);
      if (parts.length > 1) hits.set(e, (hits.get(e) ?? 0) + parts.length - 1);
      out = parts.join(e.right);
    }
    return out;
  };
  const runs = (list: readonly HandbookRun[]): HandbookRun[] => list.map((r) => ({ ...r, t: fix(r.t) }));
  const corrected = source.map((b): HandbookBlock => {
    if (b.k === "p") return { ...b, runs: runs(b.runs) };
    if (b.k === "rule") return { ...b, title: runs(b.title), body: runs(b.body) };
    if (b.k === "table") {
      return {
        ...b,
        head: b.head ? b.head.map(fix) : null,
        rows: b.rows.map((r) => ({ ...r, item: r.item.map(fix), fine: r.fine.map(fix) })),
      };
    }
    if (b.k === "sign") return { ...b, fields: b.fields.map((f) => ({ ...f, label: fix(f.label) })) };
    return b;
  });
  const wrong = register.filter((e) => (hits.get(e) ?? 0) !== (e.times ?? 1));
  if (wrong.length > 0) {
    throw new Error(
      `handbook spelling register does not fit the text: ${wrong
        .map((e) => `"${e.wrong}" landed ${hits.get(e) ?? 0}× (expected ${e.times ?? 1})`)
        .join("; ")}`,
    );
  }
  return corrected;
}

export const HANDBOOK_BLOCKS: readonly HandbookBlock[] = correctHandbook(HANDBOOK_SOURCE_BLOCKS);

/**
 * Which text a signature was given against, derived from the text itself.
 *
 * ⚠ A hash, never a hand-set string: a version typed beside the text is a second source of truth, and
 * the first edit to the JSON that forgot to bump it would record new signatures against the old
 * version. 0374 stores it on every mark, so "what did this driver sign" stays answerable after the
 * carrier amends the handbook.
 */
export const HANDBOOK_VERSION = `hb-${createHash("sha256").update(JSON.stringify(HANDBOOK_BLOCKS)).digest("hex").slice(0, 16)}`;
