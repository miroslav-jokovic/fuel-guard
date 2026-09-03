import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import { toggleSort, type SortState } from "@/lib/sort";

/**
 * A table's sort, held in the URL as two parameters (FUEL-C3, D-FUI8).
 *
 * ── WHY SORT IS PART OF "SENDABLE" AND NOT AN EXTRA ─────────────────────────────────────────────
 * C3's done-when is that a page "can be pasted into a ticket". A list sorted by MPG ascending and the
 * same list sorted by date are different answers to "look at this", and the interesting row is often
 * the first one — which is a property of the sort, not of the filters. A link that dropped it would
 * arrive showing something else.
 *
 * ── ⚠ AND WHY IT IS THE PARAMETER MOST WORTH VALIDATING ─────────────────────────────────────────
 * A sort key is a COLUMN NAME that reaches PostgREST's `.order()`. Every other filter in this section
 * fails safe when a forwarded link carries a value the page does not know — the list comes back empty
 * and the chip says why. A column name from another table does not: it is a query that errors, and
 * the page renders its failure state instead of its data. So both halves are read through
 * `useQueryState`'s `param(key, allowed)` with the caller's own column list, and this helper's whole
 * contract is that `sort.key` is either one of those columns or `null`.
 *
 * ── THE CYCLE IS `lib/sort.ts`'s, UNCHANGED ─────────────────────────────────────────────────────
 * none → asc → desc → none, from `toggleSort`. The third press clears BOTH parameters rather than
 * leaving `?dir=asc` behind on a table that is no longer sorted — a parameter that describes nothing
 * is the kind of thing somebody later tries to make mean something.
 */
export interface UrlSort {
  /** What `DataTable` binds to. `key` is `null` when the table is in its default order. */
  sort: ComputedRef<SortState>;
  /** What `DataTable`'s `@sort` calls. Writes both parameters; the buffer coalesces them. */
  onSort: (column: string) => void;
}

export function useUrlSort(
  key: WritableComputedRef<string>,
  dir: WritableComputedRef<string>,
): UrlSort {
  const sort = computed<SortState>(() => ({
    key: key.value || null,
    // Anything that is not the word `desc` is ascending, which is also what an absent parameter means.
    dir: dir.value === "desc" ? "desc" : "asc",
  }));

  const onSort = (column: string): void => {
    const next = toggleSort(sort.value, column);
    key.value = next.key ?? "";
    // Cleared with the key, never left behind on its own — see the header.
    dir.value = next.key ? next.dir : "";
  };

  return { sort, onSort };
}

/** The two parameter values a direction may take, for the `allowed` list at the call site. */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
