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
  const sorted = [...rows].sort((a, b) => {
    const av = accessor(a, key);
    const bv = accessor(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv), undefined, { numeric: true });
  });
  return dir === "asc" ? sorted : sorted.reverse();
}
