/**
 * Has FMCSA republished since our last run? (INSPECTION-CHALLENGE-PLAN IC1d, 2026-10-16.)
 *
 * ── WHY THE 24-HOUR CLOCK WAS NOT ENOUGH ──────────────────────────────────────────────────────
 * Until 2026-10-16 the feed ran once per `FMCSA_FEED_HOURS` (24) after its last success, which pinned
 * it to one time of day (~15:30–15:40 UTC on production). FMCSA does not publish at one time of day:
 * the inspection file's `rowsUpdatedAt` was 10-12 18:18, 10-14 11:04, 10-15 10:52 and 10-16 15:55 UTC,
 * and the violation and unit files publish on their own clocks (10-16 13:56 and 12:07). On 10-16 our
 * run started at 15:40 and FMCSA published at 15:55, so that day's inspections would have waited until
 * the next afternoon — up to a day of lag that was ours, on top of FMCSA's own (median 2 days from
 * inspection to publication, measured 2026-10-15).
 *
 * ── THE CHECK ─────────────────────────────────────────────────────────────────────────────────
 * Every hourly tick that is not already due asks Socrata's metadata endpoint for each dataset's
 * `rowsUpdatedAt` — one small request each, no rows — and compares it with the time the last
 * successful run of that dataset recorded (`fmcsa_fetch_runs.source_rows_updated_at`). Any dataset
 * that moved makes the whole org run: the child datasets are asked for by the inspection file's ids,
 * so a run is the six together, and replaying an unchanged one is a no-op (0457). The 24-hour clock
 * stays as the backstop for a metadata endpoint that stops answering.
 *
 * A dataset with no successful run yet counts as moved (it has never been fetched). A dataset whose
 * metadata does not state a time, or whose last run could not read one, does not: there is nothing to
 * compare, and running every hour on a missing timestamp would turn a quirk into a request storm —
 * the backstop catches it within the day.
 */
import { FMCSA_DATASETS, type FmcsaDataset } from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SocrataClient } from "./socrata.js";
import { lastSourceRowsUpdatedAt } from "./store.js";

/**
 * Pure: the datasets FMCSA has published since we last fetched them. `lastSeen` is what the last
 * successful run recorded (`undefined` = never fetched, `null` = not read); `current` is Socrata's now.
 */
export function datasetsPublishedSince(
  lastSeen: ReadonlyMap<FmcsaDataset, string | null | undefined>,
  current: ReadonlyMap<FmcsaDataset, Date | null>,
): FmcsaDataset[] {
  const moved: FmcsaDataset[] = [];
  for (const [dataset, now] of current) {
    const seen = lastSeen.get(dataset);
    if (seen === undefined) {
      moved.push(dataset);
      continue;
    }
    if (now === null || seen === null) continue;
    const seenMs = Date.parse(seen);
    if (Number.isFinite(seenMs) && now.getTime() > seenMs) moved.push(dataset);
  }
  return moved;
}

/** The datasets FMCSA has republished since the org's last successful run of each. Throws on a read failure. */
export async function publishedSinceLastRun(
  admin: SupabaseClient,
  orgId: string,
  client: SocrataClient,
): Promise<FmcsaDataset[]> {
  const lastSeen = new Map<FmcsaDataset, string | null | undefined>();
  const current = new Map<FmcsaDataset, Date | null>();
  for (const dataset of FMCSA_DATASETS) {
    lastSeen.set(dataset, await lastSourceRowsUpdatedAt(admin, orgId, dataset));
    current.set(dataset, await client.rowsUpdatedAt(dataset));
  }
  return datasetsPublishedSince(lastSeen, current);
}
