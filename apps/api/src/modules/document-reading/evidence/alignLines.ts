import { valuesAgree } from "@silvicom/shared";

/**
 * Two readers' hazmat lines, matched line to line by KEY, never by index (D-EXR5, forced by F-EX6): if
 * pass B drops line 2 of five, an index match makes lines 2–5 all "disagree" when only one is in doubt.
 * The key is the id's digit string — the field both readers almost always agree on — with the nth
 * occurrence of a repeated id matched to the nth; a line with no digits is matched to the next unmatched
 * line with no digits, in order. A line one reader has and the other lacks is left unpaired, and an
 * unpaired line is itself a disagreement.
 *
 * Pure. Returns pass B's lines re-ordered onto pass A's positions (null where B has no partner), followed
 * by B's unpaired lines, which take positions after A's last line.
 */
export interface KeyedLine { idText?: string | null }

const keyOf = (l: KeyedLine): string => (l.idText ?? "").replace(/\D/g, "");

export function alignLines<T extends KeyedLine>(a: readonly T[], b: readonly T[]): { aligned: (T | null)[]; extra: T[] } {
  const used = new Set<number>();
  const aligned = a.map((line) => {
    const k = keyOf(line);
    const j = b.findIndex((cand, i) => !used.has(i) && keyOf(cand) === k);
    if (j < 0) return null;
    used.add(j);
    return b[j]!;
  });
  return { aligned, extra: b.filter((_, i) => !used.has(i)) };
}

/**
 * Two readers' non-hazmat rows (`otherLines`, profile 1.3.0), matched row to row so each count and weight is
 * compared with its own partner. A row has no id to key on, and its description is a standard field the
 * readers word differently (line breaks, a product code kept or dropped — 68 of 267 standard fields
 * disagreed on the office BOLs, 2026-10-13), so the description cannot be the key either. The ORDER is the
 * paper's own: both readers read the freight table top to bottom. So when both read the same number of rows
 * they are paired in order; when one read more, a row is paired only with a partner whose description agrees
 * exactly (`valuesAgree`), and the rest are unpaired — a disagreement shown, never a guess.
 */
export function alignOtherLines<T extends { description: string }>(a: readonly T[], b: readonly T[]): { aligned: (T | null)[]; extra: T[] } {
  if (a.length === b.length) return { aligned: [...b], extra: [] };
  const used = new Set<number>();
  const aligned = a.map((row) => {
    const j = b.findIndex((cand, i) => !used.has(i) && valuesAgree(cand.description, row.description));
    if (j < 0) return null;
    used.add(j);
    return b[j]!;
  });
  return { aligned, extra: b.filter((_, i) => !used.has(i)) };
}
