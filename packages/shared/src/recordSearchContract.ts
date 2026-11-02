import { z } from "zod";

/**
 * Finding a record by what the office calls it — a unit number, a driver's name, a load number — from
 * the ⌘K palette (SIDEBAR-REDESIGN-PLAN.md Q-SB1, D-SB8).
 *
 * ── WHY THE TERM IS CUT DOWN BEFORE IT REACHES A QUERY ──────────────────────────────────────────
 * Every reader turns the term into an `ilike` pattern, and two readers put it inside a PostgREST
 * `.or()` filter string. In a pattern `%` and `_` are wildcards; in an `.or()` string a comma starts
 * the next condition and a parenthesis opens a group. Escaping each of those correctly in two grammars
 * is a bug waiting for an apostrophe, so the term keeps only what the things being searched are made
 * of — letters, digits, spaces, `-`, `.`, `'`, `#` — and nothing that either grammar treats as syntax.
 * A unit "T-1042", a ref "L123.4" and a driver "O'Neil" all survive; "50%" searches "50".
 */

/** Fewer characters than this find most of the fleet, and the palette is for going to ONE record. */
export const RECORD_SEARCH_MIN = 2;
/** Each kind's answer is capped: the palette shows a handful per kind, never a list to scan. */
export const RECORD_SEARCH_LIMIT = 5;

/** The term as the readers may use it, or null when nothing searchable is left. */
export function recordSearchTerm(raw: string): string | null {
  const term = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .'#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return term.length >= RECORD_SEARCH_MIN ? term : null;
}

/** `%term%` for `ilike` — safe in a pattern and in an `.or()` string, because of the cut above. */
export function recordSearchPattern(term: string): string {
  return `%${term}%`;
}

/** `GET /api/dispatch/loads/search?q=` — the term is checked again on the server, never trusted. */
export const loadSearchQuerySchema = z.object({ q: z.string().max(200) });

/**
 * No status: the board words a load from its status AND its stops (`loadBoardState`), so a status
 * word here would be a second reading of the same load that could disagree with the board's.
 */
export const loadSearchHitSchema = z.object({
  id: z.string(),
  ref: z.string(),
  customer_name: z.string().nullable(),
  driver_name: z.string().nullable(),
});
export type LoadSearchHit = z.infer<typeof loadSearchHitSchema>;

export const loadSearchResponseSchema = z.object({ loads: z.array(loadSearchHitSchema) });
export type LoadSearchResponse = z.infer<typeof loadSearchResponseSchema>;
