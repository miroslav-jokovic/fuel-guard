/**
 * Where a Samsara delta feed left off — one row per (org, feed) in `samsara_feed_cursors` (0288).
 *
 * ── WHY THIS IS A MODULE AND NOT A SECOND COPY ───────────────────────────────────────────────────
 * It was three private functions inside `samsaraStatsFeed.ts` while exactly one feed existed. LM4 adds
 * a second (`vehicle_positions`), and the two tiers need IDENTICAL cursor semantics — advance only
 * after a page is applied, never fail a run over a cursor write, treat a missing table as "no cursor".
 * Copying them would be a copy of at-least-once delivery, and the copy would diverge on the first
 * change: this repo's register for that is "a copy is a workaround with a delay fuse". So the
 * behaviour moved here unchanged and both tiers read it. The feed name is the only parameter.
 *
 * ── THE FEED NAME IS A VOCABULARY, NOT AN ENUM ───────────────────────────────────────────────────
 * 0288 made `feed` a checked text column on purpose — "a new feed is a new collector tier, which is
 * application work, and making it also a migration would buy nothing". These constants are that
 * vocabulary, and they live beside the code that uses them rather than in the schema.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The delta feed the vehicle-stats tier owns (SAM-S2). */
export const VEHICLE_STATS_FEED = "vehicle_stats";
/**
 * The delta feed the live-map positions tier owns (LM4, D-LM1d).
 *
 * ⚠ DISTINCT FROM `vehicle_stats`, AND THAT IS NOT AN IMPLEMENTATION DETAIL. Both tiers read
 * `GET /fleet/vehicles/stats/feed`, and a cursor consumed by one is gone for the other: a delta is
 * delivered once per cursor position. Sharing one row would let the 5-second positions tier eat the
 * deltas the 20-minute stats tier needs, and the loss would be SILENT — fuel-drop detection would
 * simply stop seeing the intermediate samples that are the whole reason the feed replaced a snapshot
 * poll. Two tiers reading one feed need two cursors.
 */
export const VEHICLE_POSITIONS_FEED = "vehicle_positions";

/**
 * Read this org's cursor for a feed. A MISSING TABLE is not an error here.
 *
 * A cursor table and its reader can ship in two merges, and Railway serves a merge before
 * `migrate.yml` applies the schema (docs/MIGRATION-DISCIPLINE.md §the-deploy-window — 2m44s measured
 * on 0316, and short enough that nobody can watch for it). During that window the table does not
 * exist, and the correct behaviour is precisely "no cursor": the tier seeds from the feed's head,
 * which returns every vehicle's current value. The window costs one wide read per tick and loses
 * nothing.
 */
export async function readFeedCursor(
  admin: SupabaseClient,
  orgId: string,
  feed: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("samsara_feed_cursors")
    .select("end_cursor")
    .eq("org_id", orgId)
    .eq("feed", feed)
    .maybeSingle();
  if (error) return null;
  const cur = (data as { end_cursor?: string } | null)?.end_cursor;
  return typeof cur === "string" && cur.trim() ? cur : null;
}

/**
 * Advance the cursor, AFTER its page has been applied (D-SAM4: at-least-once, never at-most-once).
 *
 * Deliberately an INSERT-or-UPDATE pair rather than `.upsert()`. A partial upsert into a table with
 * NOT NULL columns fails on rows that already exist, because Postgres evaluates NOT NULL on the
 * proposed tuple BEFORE conflict arbitration — the defect that shipped three times and took the Idling
 * and HOS syncs down (incident 2026-08-10, `lint:upserts`). This payload happens to be complete, but
 * the pair is also what makes a failure to persist NON-FATAL: losing a cursor write costs a repeated
 * page next tick, and must never lose the samples this run already applied.
 */
export async function advanceFeedCursor(
  admin: SupabaseClient,
  orgId: string,
  feed: string,
  cursor: string,
): Promise<void> {
  const { data, error } = await admin
    .from("samsara_feed_cursors")
    .update({ end_cursor: cursor })
    .eq("org_id", orgId)
    .eq("feed", feed)
    .select("org_id");
  if (error) throw error;
  if ((data ?? []).length > 0) return;
  await admin.from("samsara_feed_cursors").insert({ org_id: orgId, feed, end_cursor: cursor });
}

/** A cursor we could not store costs a repeated page next tick. It must never fail the run. */
export async function persistFeedCursorQuietly(
  admin: SupabaseClient,
  orgId: string,
  feed: string,
  cursor: string,
): Promise<void> {
  try {
    await advanceFeedCursor(admin, orgId, feed, cursor);
  } catch (e) {
    console.error(
      `[samsara-feed-cursor] ${feed} cursor write failed for org ${orgId} — the page will be re-read:`,
      e instanceof Error ? e.message : e,
    );
  }
}
