import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeScoreLeaderboardEntry, MeScoreLeaderboardResponse } from "@silvicom/shared";

/**
 * The fleet leaderboard a driver sees on Home (D-DB18, 2026-09-07 — the owner's answer to Q-DB7).
 *
 * This is the one driver-facing read that crosses into other drivers' rows, so its projection is
 * the whole design: the latest week that has ranks, its top five by FIRST NAME and rounded grade,
 * and the viewer wherever they placed. Nothing else leaves — no ids, no sub-scores, no history
 * for anyone but the viewer (that is `getDriverScore`). It is read with the service role because
 * `dpw_driver_scope` (0084) still denies the driver every row but their own, and that policy is
 * kept exactly as it was: the leaderboard is an API projection, not a policy change.
 *
 * The route refuses the request when the org's `tab.score.leaderboard` config is off, so a fleet
 * that reads rank as a secret is honoured server-side, whatever build of the app is asking.
 */

export const LEADERBOARD_TOP = 5;

interface RankRow {
  driver_id: string;
  rank: number | null;
  week_final: number | string | null;
  week_start: string;
  week_end: string;
}

interface NameRow {
  id: string;
  first_name: string | null;
  full_name: string;
}

/** The name a colleague sees: the first name, or the first word of the full name when none is stored. */
export function displayFirstName(row: Pick<NameRow, "first_name" | "full_name">): string {
  const first = row.first_name?.trim();
  if (first) return first;
  const word = row.full_name.trim().split(/\s+/)[0];
  return word && word.length > 0 ? word : "Driver";
}

const roundOrNull = (v: number | string | null): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));

/**
 * Pure assembly, so the test can pin the "top five plus me" rule without a database: ranked rows in
 * ascending rank, the viewer's own row (ranked or not), and the names. The viewer appears once —
 * inside the top five when they placed there, appended after it when they placed lower, and not
 * at all when they were not ranked that week (`my_rank` says so instead).
 */
export function assembleLeaderboard(
  ranked: readonly RankRow[],
  me: RankRow | null,
  names: ReadonlyMap<string, Pick<NameRow, "first_name" | "full_name">>,
  viewerId: string,
  cohortSize: number,
): MeScoreLeaderboardResponse {
  const week = ranked[0] ?? me;
  const top = [...ranked]
    .filter((r): r is RankRow & { rank: number } => r.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, LEADERBOARD_TOP);

  const toEntry = (r: RankRow & { rank: number }): MeScoreLeaderboardEntry => ({
    rank: r.rank,
    first_name: displayFirstName(names.get(r.driver_id) ?? { first_name: null, full_name: "Driver" }),
    score: roundOrNull(r.week_final),
    is_me: r.driver_id === viewerId,
  });

  const entries = top.map(toEntry);
  const myRank = me?.rank ?? null;
  if (me && myRank != null && !entries.some((e) => e.is_me)) {
    entries.push(toEntry({ ...me, rank: myRank }));
  }

  return {
    week_start: week?.week_start ?? null,
    week_end: week?.week_end ?? null,
    cohort_size: cohortSize,
    entries,
    my_rank: myRank,
  };
}

export async function getDriverLeaderboard(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<MeScoreLeaderboardResponse> {
  // The latest week ANY driver in this fleet was ranked — not the viewer's latest week, which may
  // be older (a driver back from leave still sees this week's board).
  const { data: latest, error: latestErr } = await admin
    .from("driver_performance_weeks")
    .select("week_start")
    .eq("org_id", orgId)
    .not("rank", "is", null)
    .order("week_start", { ascending: false })
    .limit(1);
  if (latestErr) throw new Error(latestErr.message);
  const weekStart = (latest?.[0] as { week_start: string } | undefined)?.week_start;
  if (!weekStart) {
    return { week_start: null, week_end: null, cohort_size: 0, entries: [], my_rank: null };
  }

  const [topRes, meRes, countRes] = await Promise.all([
    admin
      .from("driver_performance_weeks")
      .select("driver_id, rank, week_final, week_start, week_end")
      .eq("org_id", orgId)
      .eq("week_start", weekStart)
      .not("rank", "is", null)
      .order("rank", { ascending: true })
      .limit(LEADERBOARD_TOP),
    admin
      .from("driver_performance_weeks")
      .select("driver_id, rank, week_final, week_start, week_end")
      .eq("org_id", orgId)
      .eq("week_start", weekStart)
      .eq("driver_id", driverId)
      .maybeSingle(),
    admin
      .from("driver_performance_weeks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("week_start", weekStart)
      .not("rank", "is", null),
  ]);
  if (topRes.error) throw new Error(topRes.error.message);
  if (meRes.error) throw new Error(meRes.error.message);

  const ranked = (topRes.data ?? []) as RankRow[];
  const me = (meRes.data ?? null) as RankRow | null;
  const ids = [...new Set([...ranked.map((r) => r.driver_id), ...(me ? [me.driver_id] : [])])];

  const { data: nameRows, error: nameErr } = await admin
    .from("drivers")
    .select("id, first_name, full_name")
    .eq("org_id", orgId)
    .in("id", ids);
  if (nameErr) throw new Error(nameErr.message);
  const names = new Map(((nameRows ?? []) as NameRow[]).map((n) => [n.id, n]));

  return assembleLeaderboard(ranked, me, names, driverId, countRes.error ? 0 : (countRes.count ?? 0));
}
