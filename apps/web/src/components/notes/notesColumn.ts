import type { DataTableColumn } from "@silvicom/ui";

/**
 * The Notes column (D-UN12), one definition for Vehicles, Trailers and the roster's catalogue. Not
 * sortable: a count of notes is not an order anybody asked for, and the summary arrives after the
 * rows, so a sort on it would reshuffle the page under the reader.
 */
export const NOTES_COLUMN: DataTableColumn = { key: "notes", label: "Notes", width: "sm" };

/**
 * A table's columns with Notes placed after `afterKey` — or without it, for somebody who does not hold
 * the `notes` surface (D-UN14). Shown by default (D-UN12); the roster's picker can still hide it.
 *
 * On a table that marks its columns' place on a card, Notes is a `detail` (SMALL-SCREENS-PLAN.md
 * D-SM2). Decided here from the host and not written on `NOTES_COLUMN`: a mark on the shared constant
 * would turn every UNMARKED table it joins into a marked one — whose other columns are then all
 * `none` — and an unmarked column of a marked table is `none`, so leaving it bare hides the notes.
 */
export function withNotesColumn(columns: readonly DataTableColumn[], on: boolean, afterKey: string): DataTableColumn[] {
  const rest = columns.filter((c) => c.key !== NOTES_COLUMN.key);
  if (!on) return rest;
  const notes: DataTableColumn = rest.some((c) => c.card !== undefined) ? { ...NOTES_COLUMN, card: "detail" } : NOTES_COLUMN;
  const at = rest.findIndex((c) => c.key === afterKey);
  return at < 0 ? [...rest, notes] : [...rest.slice(0, at + 1), notes, ...rest.slice(at + 1)];
}
