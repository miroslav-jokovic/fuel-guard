/**
 * Test-only: build PDF words from lines written as `text@x`, so reader tests carry the real statements'
 * LAYOUT (measured 2026-11-18 on the owner's 18 files) without any of their account, tag or plate
 * numbers, which must never enter the repo. Not exported from the package.
 */
import type { StatementWord } from "../../reconcile/pilotStatement.js";

/** One printed line: `y`, then `"word@x"` cells; a cell may carry its own y as `"word@x@y"`. */
export type FixtureLine = [page: number, y: number, ...cells: string[]];

export function words(lines: readonly FixtureLine[]): StatementWord[] {
  const out: StatementWord[] = [];
  for (const [page, y, ...cells] of lines) {
    for (const cell of cells) {
      const [text, x, ownY] = cell.split("@");
      out.push({ text: text!, x: Number(x), y: ownY ? Number(ownY) : y, page });
    }
  }
  return out;
}
