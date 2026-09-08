import type { MeScoreLeaderboardResponse } from '@silvicom/shared';
import { weekRangeLabel } from './scoreModel';

/**
 * What Home's leaderboard says (D-DB18), decided here so `apps/driver/tests/leaderboard-model.test.ts`
 * can pin it. The API already did the hard part — the projection and the "top five plus me" rule —
 * so this only turns the wire shape into rows and one sentence about the viewer.
 */
export interface LeaderboardRow {
  key: string;
  rank: string;
  name: string;
  score: string;
  isMe: boolean;
  /** True on the viewer's row when it sits BELOW the top five, so the list draws a break above it. */
  afterGap: boolean;
}

export interface LeaderboardView {
  state: 'empty' | 'ranked';
  /** "Week of Aug 31 – Sep 6", or null before any week is ranked. */
  weekLabel: string | null;
  rows: LeaderboardRow[];
  /** "You're #9 of 23" · "You're in the top five" · "You were not ranked this week". */
  myPlace: string;
}

export function buildLeaderboardView(data: MeScoreLeaderboardResponse | undefined): LeaderboardView {
  if (!data || data.entries.length === 0 || !data.week_start) {
    return { state: 'empty', weekLabel: null, rows: [], myPlace: 'The board fills in after the first ranked week.' };
  }
  const topRanks = data.entries.filter((e) => !e.is_me || e.rank <= 5).map((e) => e.rank);
  const lastTop = Math.max(...topRanks.filter((r) => r <= 5), 0);

  const rows: LeaderboardRow[] = data.entries.map((e) => ({
    key: `${e.rank}-${e.first_name}`,
    rank: `#${e.rank}`,
    name: e.is_me ? `${e.first_name} (you)` : e.first_name,
    score: e.score == null ? '—' : String(e.score),
    isMe: e.is_me,
    afterGap: e.is_me && e.rank > lastTop + 1 && e.rank > 5,
  }));

  const myPlace =
    data.my_rank == null
      ? 'You were not ranked this week'
      : data.my_rank <= 5
        ? `You’re in the top five of ${data.cohort_size}`
        : `You’re #${data.my_rank} of ${data.cohort_size}`;

  return {
    state: 'ranked',
    weekLabel: data.week_end ? weekRangeLabel(data.week_start, data.week_end) : weekRangeLabel(data.week_start, ''),
    rows,
    myPlace,
  };
}
