import { describe, expect, it } from 'vitest';
import type { MeScoreResponse, MeScoreWeek } from '@silvicom/shared';
import {
  buildScoreView,
  homeScoreSummary,
  rankLabel,
  SCORE_DEFINITIONS,
  weekRangeLabel,
} from '@/features/score/scoreModel';

const DEFAULT_WEIGHTS = { safety: 0.5, efficiency: 0.25, idling: 0.25 };

/** A fully-ranked week; override any field per test. */
function week(overrides: Partial<MeScoreWeek> = {}): MeScoreWeek {
  return {
    week_start: '2026-07-20',
    week_end: '2026-07-26',
    safety_score: 92,
    efficiency_score: 84,
    idle_score: 79,
    safety_pct: 90,
    efficiency_pct: 80,
    idle_pct: 70,
    week_final: 87,
    trailing_final: 86,
    drive_distance_mi: 1800,
    drive_time_hours: 40,
    eligible: true,
    ineligible_reason: null,
    rank: 4,
    is_winner: false,
    cohort_size: 23,
    ...overrides,
  };
}

function resp(weeks: MeScoreWeek[], weights = DEFAULT_WEIGHTS): MeScoreResponse {
  return { weeks, weights };
}

describe('weekRangeLabel', () => {
  it('same month collapses the second month name', () => {
    expect(weekRangeLabel('2026-07-20', '2026-07-26')).toBe('Week of Jul 20 – 26');
  });
  it('spanning months keeps both', () => {
    expect(weekRangeLabel('2026-07-28', '2026-08-03')).toBe('Week of Jul 28 – Aug 3');
  });
  it('returns null on an unparseable start', () => {
    expect(weekRangeLabel('nope', '2026-08-03')).toBeNull();
  });
});

describe('rankLabel', () => {
  it('includes the cohort when known', () => {
    expect(rankLabel(4, 23)).toBe('#4 of 23');
  });
  it('drops the cohort when unknown', () => {
    expect(rankLabel(4, null)).toBe('#4');
    expect(rankLabel(4, 0)).toBe('#4');
  });
  it('is null when unranked', () => {
    expect(rankLabel(null, 23)).toBeNull();
  });
});

describe('buildScoreView — empty', () => {
  it('reports the empty state with no tiles', () => {
    const v = buildScoreView(resp([]));
    expect(v.state).toBe('empty');
    expect(v.tiles).toHaveLength(0);
    expect(v.score).toBeNull();
    expect(v.coaching).toBeNull();
  });
  it('treats undefined data as empty', () => {
    expect(buildScoreView(undefined).state).toBe('empty');
  });
});

describe('buildScoreView — ready', () => {
  // weeks are most-recent-first; last week's final was 84 → +3 this week.
  const v = buildScoreView(
    resp([week({ week_final: 87 }), week({ week_start: '2026-07-13', week_end: '2026-07-19', week_final: 84 })]),
  );

  it('rounds the hero score and labels the week', () => {
    expect(v.state).toBe('ready');
    expect(v.score).toBe(87);
    expect(v.weekLabel).toBe('Week of Jul 20 – 26');
  });
  it('shows rank of cohort and the week-over-week trend', () => {
    expect(v.rankLabel).toBe('#4 of 23');
    expect(v.trend).toEqual({ label: '+3 vs last week', direction: 'up', positive: true });
  });
  it('emits three sub-score tiles with per-week trends', () => {
    expect(v.tiles.map((t) => t.key)).toEqual(['safety', 'efficiency', 'idling']);
    expect(v.tiles.map((t) => t.value)).toEqual(['92', '84', '79']);
    // both weeks share sub-scores here, so trend rounds to flat → undefined
    expect(v.tiles).toHaveLength(3);
    expect(v.tiles[0]?.trend).toBeUndefined();
  });
  it('builds a sparkline only when ≥2 points are present', () => {
    expect(v.tiles[0]?.spark).toEqual([92, 92]); // oldest → newest
  });
});

describe('buildScoreView — coaching picks the weakest weighted component', () => {
  it('flags idling when it gives up the most weighted ground', () => {
    // idle_pct 40 with weight .25 → opportunity 15; safety_pct 95×.5→2.5; efficiency 80×.25→5
    const v = buildScoreView(resp([week({ safety_pct: 95, efficiency_pct: 80, idle_pct: 40 })]));
    expect(v.coaching).toMatch(/Idling is your best opportunity/);
  });
  it('congratulates a strong week instead of inventing a weakness', () => {
    const v = buildScoreView(resp([week({ safety_pct: 96, efficiency_pct: 92, idle_pct: 90 })]));
    expect(v.coaching).toMatch(/strong across the board/);
  });
  it('ignores a component with no feed when choosing the target', () => {
    const v = buildScoreView(
      resp([week({ safety_score: 88, safety_pct: 60, efficiency_score: null, efficiency_pct: null, idle_pct: 95, idle_score: 95 })]),
    );
    expect(v.coaching).toMatch(/Safety/);
  });
});

describe('buildScoreView — ineligible', () => {
  const v = buildScoreView(
    resp([week({ eligible: false, week_final: null, rank: null, cohort_size: null, ineligible_reason: 'below_min_miles' })]),
  );
  it('is not ranked but still shows the sub-scores', () => {
    expect(v.state).toBe('ineligible');
    expect(v.score).toBeNull();
    expect(v.rankLabel).toBeNull();
    expect(v.tiles).toHaveLength(3);
  });
  it('explains why the week did not qualify', () => {
    expect(v.ineligibleNote).toMatch(/minimum miles/);
  });
});

describe('buildScoreView — trend edges', () => {
  it('shows no trend when there is no prior week', () => {
    expect(buildScoreView(resp([week()])).trend).toBeNull();
  });
  it('marks a downward move as not positive', () => {
    const v = buildScoreView(
      resp([week({ week_final: 80 }), week({ week_start: '2026-07-13', week_end: '2026-07-19', week_final: 85 })]),
    );
    expect(v.trend).toEqual({ label: '-5 vs last week', direction: 'down', positive: false });
  });
});

describe('homeScoreSummary', () => {
  it('lists the driver’s own recent weeks with their rank, newest first, at most four', () => {
    const weeks = [
      week({ week_start: '2026-08-31', week_end: '2026-09-06', week_final: 86.4, rank: 3, cohort_size: 23 }),
      week({ week_start: '2026-08-24', week_end: '2026-08-30', week_final: 81, rank: 5, cohort_size: 22 }),
      week({ week_start: '2026-08-17', week_end: '2026-08-23', week_final: null, rank: null, eligible: false, ineligible_reason: 'short' }),
      week({ week_start: '2026-08-10', week_end: '2026-08-16', week_final: 79, rank: null, eligible: true }),
      week({ week_start: '2026-08-03', week_end: '2026-08-09', week_final: 70, rank: 9, cohort_size: 20 }),
    ];
    const recent = homeScoreSummary(resp(weeks))!.recentWeeks;
    expect(recent).toHaveLength(4);
    expect(recent[0]).toEqual({ key: '2026-08-31', label: 'Aug 31 – Sep 6', score: '86', rank: '#3 of 23' });
    expect(recent[1]!.rank).toBe('#5 of 22');
    expect(recent[2]).toMatchObject({ score: '—', rank: 'Not ranked' });
    expect(recent[3]).toMatchObject({ score: '79', rank: 'Unranked' });
  });

  it('is null with no settled weeks', () => {
    expect(homeScoreSummary(resp([]))).toBeNull();
  });
  it('splits rank into value + unit for the two-tile layout', () => {
    const s = homeScoreSummary(resp([week()]));
    expect(s).toMatchObject({ scoreValue: '87', rankValue: '#4', rankUnit: 'of 23' });
  });
  it('shows an em dash and no unit when unranked', () => {
    const s = homeScoreSummary(resp([week({ week_final: null, rank: null, cohort_size: null })]));
    expect(s).toMatchObject({ scoreValue: '—', rankValue: '—' });
    expect(s?.rankUnit).toBeUndefined();
  });
});

describe('score tiles carry their definition and their weight', () => {
  it('gives every component the fixed sentence for what it measures', () => {
    // A driver told "Efficiency 78" with no definition will assume it means whatever they most
    // fear it means. The sentence is fixed, not copy to be reworded per screen.
    const tiles = buildScoreView(resp([week()])).tiles;
    expect(tiles.map((t) => t.definition)).toEqual([
      SCORE_DEFINITIONS.safety,
      SCORE_DEFINITIONS.efficiency,
      SCORE_DEFINITIONS.idling,
    ]);
  });

  it('states each weight as a percentage of the configured total, not of one', () => {
    const tiles = buildScoreView(resp([week()], { safety: 0.5, efficiency: 0.25, idling: 0.25 })).tiles;
    expect(tiles.map((t) => t.weightLabel)).toEqual(['50%', '25%', '25%']);
  });

  it('normalises weights that do not add to one', () => {
    // The weights are a per-org configuration; nothing guarantees they sum to 1, and a row reading
    // "200% of your grade" is the kind of thing that gets noticed by a driver, not by a test.
    const tiles = buildScoreView(resp([week()], { safety: 2, efficiency: 1, idling: 1 })).tiles;
    expect(tiles.map((t) => t.weightLabel)).toEqual(['50%', '25%', '25%']);
  });

  it('survives a zero total instead of dividing by it', () => {
    const tiles = buildScoreView(resp([week()], { safety: 0, efficiency: 0, idling: 0 })).tiles;
    expect(tiles.map((t) => t.weightLabel)).toEqual(['0%', '0%', '0%']);
  });

  it('still describes a component whose feed is missing', () => {
    const tiles = buildScoreView(resp([week({ efficiency_score: null })])).tiles;
    const efficiency = tiles.find((t) => t.key === 'efficiency')!;
    expect(efficiency.value).toBe('—');
    expect(efficiency.definition).toBe(SCORE_DEFINITIONS.efficiency);
  });
});
