import { z } from "zod";

/**
 * Saved views — `/api/saved-views`. D-ROS14/15/16 (DRIVER-ROSTER-PLAN.md).
 *
 * ── A VIEW IS A NAME AND A QUERY STRING, AND NOTHING ELSE ────────────────────────────────────────
 * The URL is already the description of what a table is showing — which drivers, in what order, with
 * which columns. Storing a second description would mean keeping two things in step for ever, and
 * the moment they disagreed the saved view would silently show something other than the link that
 * created it. So a view record holds the query string verbatim. Applying a view is a navigation;
 * sharing one is a link.
 *
 * ── AND THEREFORE THE SERVER CANNOT VALIDATE ITS MEANING ─────────────────────────────────────────
 * It can check that the query is a query — a length, and no fragment or scheme smuggled in — but not
 * that `?status=banana` is sensible, because the vocabulary belongs to the page and changes with it.
 * That is deliberate and safe only because every reader normalises what it reads: `useRosterFilters`
 * turns `?page=-4` into page one rather than into an empty roster. A saved view is exactly as
 * trustworthy as a link somebody pastes, and is treated the same way.
 *
 * ── SCOPE: PER USER, PRIVATE ────────────────────────────────────────────────────────────────────
 * Ruled 2026-08-30 (§6 Q3). Not org-shared: production had 2 orgs and 6 memberships, 5 of them
 * `admin` in one org, so a sharing policy would have been written for a population that did not
 * exist. Adding `shared boolean` later is one column and one RLS clause; the primary key is the only
 * thing that would have to move.
 */

/**
 * Which tables may have views, as a closed vocabulary.
 *
 * Closed on purpose: `table_id` reaches the database from a client, and an open string means one
 * typo — or one crafted request — fills the table with rows no surface will ever list or clean up.
 * It is also the single place the id is spelled, so the column picker's storage key (R3b) and a
 * saved view agree about what "the roster" is called by construction rather than by care.
 */
export const SAVED_VIEW_TABLES = ["roster.drivers"] as const;
export type SavedViewTable = (typeof SAVED_VIEW_TABLES)[number];
export const savedViewTableSchema = z.enum(SAVED_VIEW_TABLES);

/** Long enough for a sentence a person would actually type, short enough to render in a menu. */
export const SAVED_VIEW_NAME_MAX = 60;
/**
 * A generous ceiling on the query string. The roster's own parameters come to well under 200
 * characters even with every column hidden; the limit exists so a row cannot be used as storage.
 */
export const SAVED_VIEW_QUERY_MAX = 2000;

/**
 * The query string, without its leading `?`.
 *
 * `#` and `://` are refused rather than escaped: neither can appear in a query this product
 * produces, and both are how a stored "view" would become somewhere else to send the reader.
 */
export const savedViewQuerySchema = z
  .string()
  .max(SAVED_VIEW_QUERY_MAX)
  .refine((v) => !v.includes("#"), "A view's query cannot contain a fragment")
  .refine((v) => !v.includes("://"), "A view's query cannot contain a URL");

export const savedViewNameSchema = z
  .string()
  .trim()
  .min(1, "Give the view a name")
  .max(SAVED_VIEW_NAME_MAX);

export const savedViewSchema = z.object({
  table_id: savedViewTableSchema,
  name: savedViewNameSchema,
  /** The query string as saved, e.g. `status=terminated&sort=full_name&hide=phone`. */
  query: savedViewQuerySchema,
  updated_at: z.string(),
});
export type SavedView = z.infer<typeof savedViewSchema>;

/**
 * Saving is idempotent on (table, name): saving over a name you already used replaces it, which is
 * what "save" means to the person doing it. There is no separate rename — renaming is saving under
 * the new name and deleting the old one, and a two-step API for that would invite a half-done state.
 */
export const savedViewSaveSchema = z.object({
  table_id: savedViewTableSchema,
  name: savedViewNameSchema,
  query: savedViewQuerySchema,
});
export type SavedViewSaveRequest = z.infer<typeof savedViewSaveSchema>;

export const savedViewDeleteSchema = z.object({
  table_id: savedViewTableSchema,
  name: savedViewNameSchema,
});
export type SavedViewDeleteRequest = z.infer<typeof savedViewDeleteSchema>;

export const savedViewListResponseSchema = z.object({ views: z.array(savedViewSchema) });
export type SavedViewListResponse = z.infer<typeof savedViewListResponseSchema>;

/**
 * ⚠ NO BUILT-IN VIEW CATALOGUE HERE, AND THAT IS THE DECISION — NOT AN OVERSIGHT.
 *
 * D-ROS16 rules that the carrier-standard views ship in this package, stored nowhere. It says where
 * they live, not that they exist yet. Measured on 2026-08-30, the roster can filter on status, the
 * archived toggle, a search term, sort and column choice — and every candidate built-in is either a
 * duplicate of a control the toolbar already offers in one click ("Archived", "Terminated") or not
 * expressible at all. The three that are actually wanted each need a filter over the qualification
 * rollup that does not exist until R4:
 *
 *   "Medical expiring in 30 days"  needs a filter on the overview rollup's `attention` dates
 *   "CDL expiring in 30 days"      the same
 *   "Not qualified to dispatch"    needs a filter on the rollup's `state`
 *
 * An empty registry shipped now would be structure with no content, and this codebase treats that as
 * rot rather than as slack — `check-feature-boundaries.mjs` says so about its own allow-lists. So the
 * catalogue arrives with R4, as a data change, beside the filters that make it expressible.
 */
