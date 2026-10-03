/**
 * PostgREST paging helper (audit P2-D). supabase-js caps a response at ~1000 rows, so a full-table read is
 * a `for (from = 0; ; from += PAGE) { .range(from, from+PAGE-1); if (rows < PAGE) break }` loop — which was
 * hand-rolled in 6+ services. These two helpers collapse that loop to one call while preserving the
 * incremental (per-page) processing the large scans rely on to bound memory.
 */

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Run a `.range()` query page by page, invoking `onPage` for each batch, until a short page ends it. Throws
 * on a page error (the PostgREST message is preserved). Processing per page keeps peak memory at one page
 * for the large scans (fuel_prices, fuel_transactions) instead of materializing the whole table.
 */
export async function eachPage<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  onPage: (rows: T[]) => void,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<void> {
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    onPage(rows);
    if (rows.length < pageSize) break;
  }
}

/** Collect ALL rows of a paged query into one array (throws on error). Use for bounded result sets. */
export async function fetchAllPaged<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  await eachPage<T>(makeQuery, (rows) => out.push(...rows), pageSize);
  return out;
}
