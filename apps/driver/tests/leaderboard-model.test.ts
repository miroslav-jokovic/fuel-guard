import { describe, expect, it } from 'vitest';
import type { MeScoreLeaderboardResponse } from '@silvicom/shared';
import { buildLeaderboardView } from '@/features/score/leaderboardModel';

const board = (over: Partial<MeScoreLeaderboardResponse> = {}): MeScoreLeaderboardResponse => ({
  week_start: '2026-08-31',
  week_end: '2026-09-06',
  cohort_size: 23,
  entries: [
    { rank: 1, first_name: 'Ana', score: 94, is_me: false },
    { rank: 2, first_name: 'Bojan', score: 91, is_me: false },
    { rank: 3, first_name: 'Cara', score: 88, is_me: false },
    { rank: 4, first_name: 'Dmitri', score: 85, is_me: false },
    { rank: 5, first_name: 'Eve', score: 80, is_me: false },
    { rank: 9, first_name: 'Miki', score: 72, is_me: true },
  ],
  my_rank: 9,
  ...over,
});

describe('leaderboard view', () => {
  it('draws the top five, then the viewer after a break, and says where they placed', () => {
    const view = buildLeaderboardView(board());
    expect(view.state).toBe('ranked');
    expect(view.weekLabel).toBe('Week of Aug 31 – Sep 6');
    expect(view.rows.map((r) => [r.rank, r.name, r.score, r.isMe, r.afterGap])).toEqual([
      ['#1', 'Ana', '94', false, false], ['#2', 'Bojan', '91', false, false], ['#3', 'Cara', '88', false, false],
      ['#4', 'Dmitri', '85', false, false], ['#5', 'Eve', '80', false, false], ['#9', 'Miki (you)', '72', true, true],
    ]);
    expect(view.myPlace).toBe('You’re #9 of 23');
  });

  it('draws no break when the viewer is sixth, and none at all when they are in the top five', () => {
    const sixth = board({ entries: [...board().entries.slice(0, 5), { rank: 6, first_name: 'Miki', score: 79, is_me: true }], my_rank: 6 });
    expect(buildLeaderboardView(sixth).rows[5]!.afterGap).toBe(false);
    const inTop = board({
      entries: [{ rank: 1, first_name: 'Ana', score: 94, is_me: false }, { rank: 2, first_name: 'Miki', score: 92, is_me: true }],
      my_rank: 2,
    });
    const view = buildLeaderboardView(inTop);
    expect(view.rows.every((r) => !r.afterGap)).toBe(true);
    expect(view.myPlace).toBe('You’re in the top five of 23');
  });

  it('says the viewer was not ranked rather than inventing a place', () => {
    const view = buildLeaderboardView(board({ entries: board().entries.slice(0, 5), my_rank: null }));
    expect(view.rows.some((r) => r.isMe)).toBe(false);
    expect(view.myPlace).toBe('You were not ranked this week');
  });

  it('is empty before any week is ranked, and with no data at all', () => {
    expect(buildLeaderboardView(board({ week_start: null, week_end: null, entries: [], my_rank: null, cohort_size: 0 })).state).toBe('empty');
    expect(buildLeaderboardView(undefined).state).toBe('empty');
  });

  it('prints a dash for a viewer row without a grade', () => {
    const view = buildLeaderboardView(board({ entries: [...board().entries.slice(0, 5), { rank: 9, first_name: 'Miki', score: null, is_me: true }] }));
    expect(view.rows[5]!.score).toBe('—');
  });
});
