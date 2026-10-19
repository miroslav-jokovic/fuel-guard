import { valuesAgree } from "@silvicom/shared";

/**
 * Two readers' hazmat lines, matched line to line by KEY, never by index (D-EXR5, forced by F-EX6): if
 * pass B drops line 2 of five, an index match makes lines 2–5 all "disagree" when only one is in doubt.
 *
 * Pass 1 — the id. The key is the id's digit string — the field both readers almost always agree on. Lines are
 * paired in the paper's order first, as a diff pairs two texts: the most lines with equal keys that keep
 * both readers' order, ties broken toward the pairing whose names, counts and weights agree most. Then any
 * line still unpaired is matched to the next unpaired line of the other reader with the same key, so a
 * reader that listed two lines in the other order still has both paired. (Until RC3 it was first-come only:
 * on the owner's BOL the two identical UN3264 lines crossed, and the misread line between them had no
 * stretch of the paper left to be found in.)
 *
 * Pass 2 — the same line read with a different id (READER-CORRECTNESS-PLAN RC3). Pass 1 alone turned ONE
 * misread digit into TWO lines: on the owner's BOL of 2026-10-19 pass A read UN3254 where pass B read UN3264,
 * each was left unpaired, and the calculator got two products and could count the drums' weight twice. So a
 * line pass 1 left unpaired is paired with an unpaired line of the other reader when ALL of these hold, and
 * only when exactly one such line exists:
 *   - it sits where the line sits in the paper's order — after the partner of the nearest paired line above,
 *     before the partner of the nearest paired line below;
 *   - the ids are one misread apart: equally long and differing in one digit or one swapped pair, or one
 *     reader read no id at all;
 *   - the line itself agrees: the shipping name, the count or the gross weight — two of them when one id is
 *     missing, since then the id says nothing.
 * Paired, the two ids are one field the readers disagree on, which stops Calculate until a person picks
 * (D-DR24) — the disagreement is shown on one line instead of hidden as two. Two real lines one digit apart
 * (UN1202 and UN1203 on one paper) are both read by both readers and paired by pass 1 first; a leftover pair
 * that fits none of the above stays apart, a disagreement shown, never a guess.
 *
 * Pure. Returns pass B's lines re-ordered onto pass A's positions (null where B has no partner), followed
 * by B's unpaired lines, which take positions after A's last line.
 */
export interface KeyedLine {
  idText?: string | null;
  psn?: string | null;
  packageCount?: number | null;
  grossWeightLb?: number | null;
}

const keyOf = (l: KeyedLine): string => (l.idText ?? "").replace(/\D/g, "");

/** One misread apart: one digit different, or two neighbours swapped. Identical keys are pass 1's. */
function oneMisreadApart(x: string, y: string): boolean {
  if (x.length !== y.length || x === y) return false;
  const diff = [...x].flatMap((c, i) => (c === y[i] ? [] : [i]));
  if (diff.length === 1) return true;
  return diff.length === 2 && diff[1] === diff[0]! + 1 && x[diff[0]!] === y[diff[1]!] && x[diff[1]!] === y[diff[0]!];
}

/** How many of the line's own fields the two readings agree on: name, count, gross weight. */
function contentAgreement(x: KeyedLine, y: KeyedLine): number {
  const same = (u: unknown, v: unknown) => u != null && v != null && valuesAgree(u, v);
  return [same(x.psn, y.psn), same(x.packageCount, y.packageCount), same(x.grossWeightLb, y.grossWeightLb)].filter(Boolean).length;
}

function samePrintedLine(x: KeyedLine, y: KeyedLine): boolean {
  const kx = keyOf(x);
  const ky = keyOf(y);
  if (kx === "" || ky === "") return contentAgreement(x, y) >= 2;
  return oneMisreadApart(kx, ky) && contentAgreement(x, y) >= 1;
}

/** The order-keeping pairing with the most equal keys, then the most agreeing content (an LCS over keys). */
function inOrder<T extends KeyedLine>(a: readonly T[], b: readonly T[]): (number | null)[] {
  const W = 4; // a pair outweighs any content: content agreement is 0–3 per pair
  const score: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const pair = keyOf(a[i]!) === keyOf(b[j]!) ? W + contentAgreement(a[i]!, b[j]!) + score[i + 1]![j + 1]! : -1;
      score[i]![j] = Math.max(pair, score[i + 1]![j]!, score[i]![j + 1]!);
    }
  }
  const partner: (number | null)[] = a.map(() => null);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    const pair = keyOf(a[i]!) === keyOf(b[j]!) ? W + contentAgreement(a[i]!, b[j]!) + score[i + 1]![j + 1]! : -1;
    if (pair === score[i]![j]) { partner[i] = j; i++; j++; }
    else if (score[i + 1]![j] === score[i]![j]) i++;
    else j++;
  }
  return partner;
}

export function alignLines<T extends KeyedLine>(a: readonly T[], b: readonly T[]): { aligned: (T | null)[]; extra: T[] } {
  const partner = inOrder(a, b);
  const used = new Set(partner.filter((j): j is number => j !== null));
  for (let i = 0; i < a.length; i++) {
    if (partner[i] !== null) continue;
    const k = keyOf(a[i]!);
    const j = b.findIndex((cand, n) => !used.has(n) && keyOf(cand) === k);
    if (j >= 0) { partner[i] = j; used.add(j); }
  }

  const pass1 = [...partner];
  for (let i = 0; i < a.length; i++) {
    if (partner[i] !== null) continue;
    const above = pass1.slice(0, i).filter((j): j is number => j !== null);
    const below = pass1.slice(i + 1).filter((j): j is number => j !== null);
    const lo = above.length ? Math.max(...above) : -1;
    const hi = below.length ? Math.min(...below) : b.length;
    const fits = b.flatMap((cand, j) => (!used.has(j) && j > lo && j < hi && samePrintedLine(a[i]!, cand) ? [j] : []));
    if (fits.length !== 1) continue;
    // The match must be mutual: no other unpaired line of A in the same stretch fits that line of B too.
    const rivals = a.filter((other, k) => k !== i && partner[k] === null && samePrintedLine(other, b[fits[0]!]!));
    if (rivals.length > 0) continue;
    partner[i] = fits[0]!;
    used.add(fits[0]!);
  }

  return { aligned: partner.map((j) => (j === null ? null : b[j]!)), extra: b.filter((_, i) => !used.has(i)) };
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
