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
 */
export function withNotesColumn(columns: readonly DataTableColumn[], on: boolean, afterKey: string): DataTableColumn[] {
  const rest = columns.filter((c) => c.key !== NOTES_COLUMN.key);
  if (!on) return rest;
  const at = rest.findIndex((c) => c.key === afterKey);
  return at < 0 ? [...rest, NOTES_COLUMN] : [...rest.slice(0, at + 1), NOTES_COLUMN, ...rest.slice(at + 1)];
}
