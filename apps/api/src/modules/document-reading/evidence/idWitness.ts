import { valuesAgree, type PrintedHazmatLine } from "@silvicom/shared";
import type { HmtVerdict } from "./hmtWitness.js";
import { anchorOf, rowOf, tokens, type OcrPage, type Row } from "./rowWitness.js";

/**
 * The page settling a UN/NA number the two readers split on (READER-CORRECTNESS-PLAN Q-RC7, owner 2026-10-21:
 * "proceed as recommended", answer (a)).
 *
 * Identifying fields stay with the table and the readers (rowWitness.ts): an OCR word alone never decides what a
 * line IS. But a one-digit misread by one reader — production read 76979453, pass A "UN3254" against pass B
 * "UN3264", 16 of the 43 "confirm it first" left on the five stored reads — has three independent sources that
 * can each say which reading the paper prints, and the number is settled only when all three say the same:
 *
 *   1. the readers agree on everything else that identifies the line — its shipping name, class and PG;
 *   2. the Hazardous Materials Table finds exactly ONE of the two numbers consistent with that name, class and
 *      PG (UN3264 is "Corrosive liquid, acidic, inorganic, n.o.s.", 8; UN3254 is Tributylphosphane, 4.2);
 *   3. the OCR (or a born-digital page's text layer) prints that number on the line's own row — the row that
 *      also prints the agreed name — and prints the other reading nowhere the other lines do not account for.
 *
 * It never reads a value of its own: the settled number is one a reader read. It never says a reading is wrong:
 * where any condition fails it records nothing, and the line waits for a person as before. The whole-table test
 * (`idWitness.test.ts`) runs every entry against every one-digit neighbour that is also an entry.
 */

/** The letter words of a shipping name a row must print to be this line's row: the first two of three letters or more. */
function nameWords(psn: string | null | undefined): string[] {
  return tokens(psn ?? "").filter((t) => /^[A-Z]{3,}$/.test(t)).slice(0, 2);
}

const printedAnchors = (pages: readonly OcrPage[], id: string) =>
  pages.reduce((n, p) => n + p.items.filter((i) => tokens(i.text).includes(id)).length, 0);

export interface SettledId {
  /** The settled reading, as the reader that read it wrote it. */
  value: string;
  /** Which reader read it. */
  reader: "passA" | "passB";
  row: Row;
}

/**
 * The reading of line `i`'s id the page settles, or null. `a` and `b` are the two readers' readings of the line;
 * `verdict` is the table's on pass A's reading with `passB` its verdict on pass B's (shippingEvidence.ts);
 * `others` the ids every OTHER read line carries, in the paper's order, with `before` how many of them precede
 * line `i`.
 */
export function settledId(
  pages: readonly OcrPage[] | null,
  a: Pick<PrintedHazmatLine, "idText" | "psn" | "hazardClass" | "pg">,
  b: Pick<PrintedHazmatLine, "idText" | "psn" | "hazardClass" | "pg">,
  verdict: HmtVerdict & { passB?: HmtVerdict },
  others: readonly (string | null | undefined)[],
  before: number,
): SettledId | null {
  if (!pages) return null;
  const ida = anchorOf(a.idText);
  const idb = anchorOf(b.idText);
  if (!ida || !idb || ida === idb) return null;
  // 1. Everything else that identifies the line is agreed.
  if (!nameWords(a.psn).length || !valuesAgree(a.psn, b.psn) || !valuesAgree(a.hazardClass, b.hazardClass) || !valuesAgree(a.pg, b.pg)) return null;
  // 2. The table finds exactly one of the two readings consistent with them.
  const fitsA = verdict.consistent;
  const fitsB = verdict.passB?.consistent === true;
  if (fitsA === fitsB) return null;
  const [want, other, reader, line] = fitsA ? [ida, idb, "passA" as const, a] : [idb, ida, "passB" as const, b];
  // 3. The page prints the settled number once more than the other lines carry it, and the other reading no more
  // often than the other lines carry it — then the nth printed anchor is this line's row …
  const otherIds = others.map(anchorOf);
  const carrying = (id: string) => otherIds.filter((x) => x === id).length;
  if (printedAnchors(pages, other) !== carrying(other)) return null;
  // (rowOf abstains unless the settled number is printed exactly as often as the lines that carry it, this one included.)
  const nth = otherIds.slice(0, before).filter((x) => x === want).length;
  const row = rowOf(pages, want, nth, carrying(want) + 1);
  if (!row) return null;
  // … provided that row prints the agreed name: a row of another line with the same number does not settle this one.
  const rowTokens = new Set(row.items.flatMap((it) => tokens(it.text)));
  if (!nameWords(line.psn).every((w) => rowTokens.has(w))) return null;
  return { value: line.idText!, reader, row };
}

/**
 * The description a settled id settles with it: the settled reader's, when the other reader's reads the same once
 * its own number is replaced by the settled one ("UN3254, CORROSIVE LIQUID, …" against "UN3264, CORROSIVE
 * LIQUID, …"). Null when the two differ in anything else — that is a second disagreement, for a person.
 */
export function settledDescription(settled: SettledId, a: string | null | undefined, b: string | null | undefined, idA: string, idB: string): string | null {
  if (typeof a !== "string" || typeof b !== "string") return null;
  const [mine, theirs, theirId] = settled.reader === "passA" ? [a, b, idB] : [b, a, idA];
  const want = anchorOf(settled.value)!;
  // Their number as the description prints it: "UN3254" or "UN 3254" alike.
  const id = anchorOf(theirId);
  if (!id) return null;
  const swapped = theirs.replace(new RegExp(`\\b${id.slice(0, 2)}\\s*${id.slice(2)}\\b`, "i"), want);
  return swapped !== theirs && valuesAgree(swapped, mine) ? mine : null;
}
