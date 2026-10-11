/**
 * Whether a summary tile has a figure to show, and what it shows when it has none (F02-F04 chunk 11c,
 * AUDIT.md N9 and §4.2).
 *
 * A tile that reads `totals?.x ?? 0` prints $0 while its query loads and $0 when it fails, and a zero is a
 * claim about the fleet: "nothing was spent", "nothing is flagged". The audit's screenshot of the
 * findings page with the API unreachable read "$0 / 0 money findings". So a tile with no answer says so,
 * in the same two strings on every page: a dash where the number goes, "Not available" where its
 * sub-line goes.
 *
 * ⚠ Placeholder data counts as NO figure. Both pages keep the previous window's answer on screen while a
 * new one loads (`keepPreviousData`), which is right for a table — rows that will be replaced are still
 * rows — and wrong for a total, which would sit under a filter bar naming a window it does not describe.
 * The dash lasts as long as the request.
 */
export const NO_FIGURE = "—";
export const NO_FIGURE_NOTE = "Not available";

/** The three facts of a vue-query result a tile needs, unwrapped. */
export interface TileQuery {
  data: unknown;
  isError: boolean;
  isPlaceholderData: boolean;
}

/** True only when the query holds its OWN answer for the current inputs. */
export const tileReady = (q: TileQuery): boolean => q.data != null && !q.isError && !q.isPlaceholderData;
