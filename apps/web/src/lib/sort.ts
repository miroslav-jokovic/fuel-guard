// Small client-side sort helper shared by tables.
export type SortDir = "asc" | "desc";
export interface SortState {
  key: string | null;
  dir: SortDir;
}

/** Cycle a column: none → asc → desc → none. */
export function toggleSort(s: SortState, key: string): SortState {
  if (s.key !== key) return { key, dir: "asc" };
  if (s.dir === "asc") return { key, dir: "desc" };
  return { key: null, dir: "asc" };
}

/** Stable-ish sort of rows by a key (numbers numerically, strings naturally); nulls last. */
export function sortRows<T>(rows: T[], state: SortState, get?: (row: T, key: string) => unknown): T[] {
  const { key, dir } = state;
  if (!key) return rows;
  const accessor = get ?? ((r: T, k: string) => (r as Record<string, unknown>)[k]);
  // A null cell means "not measured" (a rate with no miles, a date nobody entered), and it sorts
  // LAST under both directions: reversing the whole list used to float every blank to the top of a
  // descending sort, which is where a reader looks for the largest value. Present values reverse;
  // absent ones stay at the end.
  const present = rows.filter((r) => accessor(r, key) != null);
  const absent = rows.filter((r) => accessor(r, key) == null);
  const sorted = [...present].sort((a, b) => {
    const av = accessor(a, key);
    const bv = accessor(b, key);
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv), undefined, { numeric: true });
  });
  return [...(dir === "asc" ? sorted : sorted.reverse()), ...absent];
}
