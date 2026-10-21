/**
 * What "newest paper" means, in one place (UNIT-FILES-PLAN Q-UF10, owner 2026-10-21): the date the
 * paper is OF, not the moment our row was written.
 *
 * `created_at` was the order until 2026-10-21, and it was right while every paper came in through the
 * app on the day it was scanned. The McLeod import (#1684) broke that: 1,359 papers written within
 * forty minutes of 10/20, each carrying the date the office filed it in McLeod (2014–2026) in
 * `captured_at`. Sorted by `created_at`, a 2021 cab card imported on 10/20 outranked an annual uploaded
 * on 10/06 — 27 trucks and 3 trailers drew the wrong three thumbnails, and every imported paper's hover
 * card said "Filed 10/20/2026".
 *
 * `captured_at` is set on every unit original today (0 nulls, measured 2026-10-21); `created_at` stands
 * in for a paper that never said when it was scanned. The list cell (`paperThumbs.ts`), the gallery
 * (`FileGallery.vue`) and the gallery's strip all sort with this, so the cell's first thumbnail is the
 * gallery's first page and they cannot drift apart again.
 */
export interface DatedPaper {
  id: string;
  capturedAt: string | null;
  createdAt: string;
}

/** The date a paper is of: when it was scanned or filed at source, else when we wrote its row. */
export const paperDate = (p: Pick<DatedPaper, "capturedAt" | "createdAt">): string => p.capturedAt ?? p.createdAt;

/**
 * Newest first. Ties — two papers of one day, which the import produces for a unit whose office filed
 * several scans at once — fall to the later row, then the id, so the order is the same on every read
 * and the cell and the gallery never disagree over which of two equal papers comes first.
 *
 * Compared as strings: both columns are ISO-8601 from PostgREST, and a date-only `captured_at`
 * ("2026-02-23") sorts by its day against a full timestamp, which is the precision the paper has.
 */
export function newestPaperFirst(a: DatedPaper, b: DatedPaper): number {
  return paperDate(b).localeCompare(paperDate(a)) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
