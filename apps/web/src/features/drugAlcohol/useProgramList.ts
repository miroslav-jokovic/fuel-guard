import { computed, watch, type Ref } from "vue";
import { SORT_DIRECTIONS, sortRows, useQueryState, useUrlSort, type DataTableColumn, type UrlQueryState } from "@silvicom/ui";

export const PROGRAM_PAGE_SIZE = 20;

/**
 * One tab's list on Safety › Drug & Alcohol, in the house list shape (DESIGN-SYSTEM-CONTRACT §5.2b,
 * §5.2c): a search, the tab's own filters, a sort and a page, all in the URL so a reload, a pasted
 * link and Back return the same list.
 *
 * Each tab keeps its state under its own prefix (`random.search`, `medical.page`): the five tabs share
 * one route, and without the prefix a name typed into Results would still be narrowing Medical cards
 * when the reader switched to it. The tab itself is the page's `?tab=`, never cleared from here.
 *
 * `narrow` is the tab's filters other than the search, applied before it; `filters` is every value
 * that should send the reader back to page 1 when it changes, and that "Clear filters" resets.
 */
export function useProgramList<T>(opts: {
  scope: string;
  rows: Ref<readonly T[]>;
  columns: DataTableColumn[];
  /** The text a search looks in: the person's name, then whatever else the tab shows. */
  text: (row: T) => (string | null | undefined)[];
  /** The tab's own filters, already read from `qs`. */
  narrow?: (row: T) => boolean;
  /** The filter parameters "Clear filters" removes, and their current values (for the page reset and the count). */
  filters?: () => Record<string, string>;
  qs?: UrlQueryState;
}) {
  const qs = opts.qs ?? useQueryState(opts.scope);
  const search = qs.param("search");
  const page = qs.page();
  const { sort, onSort } = useUrlSort(
    qs.param("sort", opts.columns.filter((c) => c.sortable).map((c) => c.key)),
    qs.param("dir", SORT_DIRECTIONS),
  );

  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    const kept = opts.rows.value.filter(
      (r) => (!opts.narrow || opts.narrow(r)) && (!term || opts.text(r).some((v) => v?.toLowerCase().includes(term))),
    );
    return sortRows([...kept], sort.value);
  });
  const pageRows = computed(() => filtered.value.slice((page.value - 1) * PROGRAM_PAGE_SIZE, page.value * PROGRAM_PAGE_SIZE));

  const filterValues = () => opts.filters?.() ?? {};
  /** The search counts as a filter (§5.5 rule 5); a filter at its default reads `""` and does not. */
  const activeCount = computed(() => [search.value.trim(), ...Object.values(filterValues())].filter(Boolean).length);
  const clearAll = () =>
    qs.set({ search: undefined, ...Object.fromEntries(Object.keys(filterValues()).map((k) => [k, undefined])) });

  watch([search, () => JSON.stringify(filterValues()), () => sort.value.key, () => sort.value.dir], () => (page.value = 1));
  // A refetch that shortens the list never strands the reader past its last page.
  watch(
    () => filtered.value.length,
    (n) => {
      const last = Math.max(1, Math.ceil(n / PROGRAM_PAGE_SIZE));
      if (page.value > last) page.value = last;
    },
  );

  return { qs, search, page, sort, onSort, filtered, pageRows, activeCount, clearAll, pageSize: PROGRAM_PAGE_SIZE };
}

/** The Test filter every tab offers: Med-Stop's three services, in the words the rows use. */
export const KIND_OPTIONS = [
  { value: "drug", label: "Drug" },
  { value: "alcohol", label: "Alcohol" },
  { value: "medical", label: "Medical" },
] as const;
export const KINDS = KIND_OPTIONS.map((o) => o.value);
export const kindText = (kind: string) => (kind === "drug" ? "Drug" : kind === "alcohol" ? "Alcohol" : kind === "medical" ? "Medical" : "Other");
