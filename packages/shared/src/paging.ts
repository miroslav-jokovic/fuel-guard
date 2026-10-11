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

/**
 * How many ids one `.in()` filter may carry. Two ceilings, both measured on the Loads board 2026-10-09:
 *
 *  · the URL. An `.in()` puts every id in the query string (37 bytes a uuid), and PostgREST echoes the
 *    request path back in `Content-Location`. Past ~16 KB of response headers Node 22's fetch refuses
 *    the reply (`UND_ERR_HEADERS_OVERFLOW`, surfacing as "fetch failed") — 400 load ids already did.
 *    Node 26 raised the limit, which is why the same read passed on a laptop and failed on Railway.
 *  · the rows. Each id may bring several rows back (a McLeod load has up to 12 stops), and PostgREST
 *    caps a response at 1,000; 50 ids keep a stops read under it.
 *
 * 50 ids is under 2 KB of URL, so both hold with room to spare.
 */
export const IN_LIST_CHUNK = 50;

/** `items` cut into consecutive slices of at most `size` (the last may be shorter). */
export function chunks<T>(items: readonly T[], size = IN_LIST_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
