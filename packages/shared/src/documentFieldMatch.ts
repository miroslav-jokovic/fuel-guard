import type { PrintedHazmatLine } from "./shippingDocumentContract.js";

/**
 * The two judgements `doc:score` makes before it counts anything (DOCUMENT-READER-PLAN.md Step 0.4):
 * is a read value EQUAL to its label, and which read hazmat line IS which labelled line. Both are defined
 * once, here, so the corpus score, the Phase 2 cross-check (F-EX6) and the production review counters
 * (D-DR5) cannot each grow their own idea of "the same value".
 */

// ── value equality ─────────────────────────────────────────────────────────────────────────────────
/**
 * Whitespace is layout, not data: trim, and collapse every internal run of whitespace (a line break in a
 * wrapped address, a double space a printer left) to one space. Nothing else is normalised.
 */
function normaliseText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Whether a read value equals its label — deliberately CONSERVATIVE, because every "equal" this answers
 * yes to is a value the score certifies as correct, and a generous equality hides false accepts:
 *   - strings: equal after `normaliseText`, and CASE-SENSITIVE. Case is printed data on a shipping paper:
 *     an identifier ("UN1203" against "un1203"), a seal or a BOL number may be case-significant in the
 *     shipper's own system, and the reader's job is to transcribe what is printed, not what it means. A
 *     reader that changes case has changed the value, and the score must say so;
 *   - numbers: exact (`===`). 1203 and 1203.0 are one number; 1,203 read as 1.203 is not;
 *   - booleans and null: identity. `undefined` (the field does not exist in that document) is the
 *     caller's to map — this function treats it as unequal to everything but itself;
 *   - arrays (string lists such as `marks`, `seals`, `references.po`): equal as MULTISETS of normalised
 *     members — order on the paper carries no meaning for these, but a repeated mark is still counted;
 *   - objects: equal key by key under the same rules.
 * No fuzzy matching, no edit distance, no "close enough" (plan §4.3: identifiers are never corrected,
 * only resolved or refused). A near-miss is a wrong value.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return normaliseText(a) === normaliseText(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const pool = [...b];
    for (const v of a) {
      const i = pool.findIndex((w) => valuesEqual(v, w));
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

// ── hazmat line alignment by KEY (F-EX6 / D-EXR5) ──────────────────────────────────────────────────
/**
 * The digits of a printed id: "UN1203", "UN 1203", "NA-1993", "1203" → "1203", "1993"; "" when the line
 * prints no id (the F-DR11 battery BOL). The prefix is not part of the KEY because the key only decides
 * which lines are the same line; whether the reader got "UN" right is `idText`'s own score.
 */
export function hazmatLineKey(idText: string | null): string {
  return (idText ?? "").replace(/\D/g, "");
}

export interface HazmatLineAlignment {
  /** Matched lines, `label` and `read` being indexes into their own `lines` arrays. */
  pairs: Array<{ label: number; read: number }>;
  /** Labelled lines no read line matched — every field on them is a miss. */
  missed: number[];
  /** Read lines no labelled line matched — counted, and any `read` field on them is a false accept. */
  extra: number[];
}

/**
 * Which read line is which labelled line — by KEY, never by index (F-EX6). Index alignment is how the old
 * pipeline scored a reader that skipped line 1 as wrong on every line after it, and, worse, scored two
 * readers that skipped DIFFERENT lines as agreeing on lines they never shared.
 *
 * The rule, greedy in labelled order, each read line used at most once:
 *   1. a labelled line WITH id digits matches an unused read line with the same digits;
 *   2. a labelled line WITHOUT id digits matches only an unused read line also without digits whose PSN
 *      is equal (`valuesEqual`) — a line with neither an id nor a PSN cannot be keyed and is a miss;
 *   3. when several candidates remain (two lines of UN1203 on one paper), the first whose PSN is equal
 *      wins, else the first in read order — so a tie-break never changes a value's verdict, only which
 *      of two same-id lines it is compared with.
 * Unmatched labelled lines are `missed`; unmatched read lines are `extra`.
 */
export function alignHazmatLines(
  label: readonly PrintedHazmatLine[],
  read: readonly PrintedHazmatLine[],
): HazmatLineAlignment {
  const used = new Set<number>();
  const pairs: HazmatLineAlignment["pairs"] = [];
  const missed: number[] = [];
  label.forEach((l, li) => {
    const key = hazmatLineKey(l.idText);
    const candidates = read
      .map((r, ri) => ({ r, ri }))
      .filter(({ r, ri }) => {
        if (used.has(ri)) return false;
        if (key) return hazmatLineKey(r.idText) === key;
        return !hazmatLineKey(r.idText) && l.psn != null && valuesEqual(l.psn, r.psn);
      });
    const pick = candidates.find(({ r }) => l.psn != null && valuesEqual(l.psn, r.psn)) ?? candidates[0];
    if (!pick) {
      missed.push(li);
      return;
    }
    used.add(pick.ri);
    pairs.push({ label: li, read: pick.ri });
  });
  const extra = read.map((_, ri) => ri).filter((ri) => !used.has(ri));
  return { pairs, missed, extra };
}
