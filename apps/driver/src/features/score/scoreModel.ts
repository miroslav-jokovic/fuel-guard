import type { MeScoreResponse, MeScoreWeek, PerformanceWeightsView } from '@fuelguard/shared';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * My Score — pure view model (Phase 5, docs/16-DRIVER-PERFORMANCE.md). Turns the driver's own frozen
 * weeks into exactly what the Score screen and the Home "This week" tiles render: the week's grade, the
 * three sub-scores with their trends and sparklines, a rank line, and one plain-language coaching line
 * from the weakest weighted component. No fabricated projections — every number shown is a stored fact.
 */

export type ScoreComponentKey = 'safety' | 'efficiency' | 'idling';

export interface ScoreTrend {
  label: string;
  direction: 'up' | 'down';
  positive: boolean;
}

export interface ScoreTile {
  key: ScoreComponentKey;
  label: string;
  icon: MaterialSymbolName;
  value: string;
  spark?: number[];
  trend?: ScoreTrend;
}

export interface ScoreView {
  state: 'empty' | 'ineligible' | 'ready';
  weekLabel: string | null;
  score: number | null;
  rankLabel: string | null;
  isWinner: boolean;
  trend: ScoreTrend | null;
  tiles: ScoreTile[];
  coaching: string | null;
  ineligibleNote: string | null;
}

export interface HomeScoreSummary {
  scoreValue: string;
  scoreSpark?: number[];
  scoreTrend?: ScoreTrend;
  /** Split for the two-tile Home layout: "#4" + "of 23" (or "—" with no unit when unranked). */
  rankValue: string;
  rankUnit?: string;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** "Week of Jul 20 – 26" (same month) or "Week of Jul 28 – Aug 3" (spanning). Date-string safe (no TZ). */
export function weekRangeLabel(weekStart: string, weekEnd: string): string | null {
  const a = parseYmd(weekStart);
  if (!a) return null;
  const b = parseYmd(weekEnd);
  const left = `${MONTHS[a.m - 1]} ${a.d}`;
  if (!b) return `Week of ${left}`;
  const right = a.m === b.m ? `${b.d}` : `${MONTHS[b.m - 1]} ${b.d}`;
  return `Week of ${left} – ${right}`;
}

/** Rounded delta for higher-is-better metrics, or null when either side is missing or it rounds to flat. */
function roundedDelta(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null) return null;
  const r = Math.round(curr - prev);
  return r === 0 ? null : r;
}

function trendFromDelta(delta: number | null, suffix = ''): ScoreTrend | undefined {
  if (delta == null) return undefined;
  const up = delta > 0;
  const sign = up ? '+' : '-';
  return {
    label: `${sign}${Math.abs(delta)}${suffix}`,
    direction: up ? 'up' : 'down',
    positive: up,
  };
}

/** "#4 of 23" when the cohort is known, "#4" when it isn't, null when unranked. */
export function rankLabel(rank: number | null, cohort: number | null): string | null {
  if (rank == null) return null;
  return cohort != null && cohort > 0 ? `#${rank} of ${cohort}` : `#${rank}`;
}

const SELECTORS: Record<ScoreComponentKey, { score: (w: MeScoreWeek) => number | null; pct: (w: MeScoreWeek) => number | null }> = {
  safety: { score: (w) => w.safety_score, pct: (w) => w.safety_pct },
  efficiency: { score: (w) => w.efficiency_score, pct: (w) => w.efficiency_pct },
  idling: { score: (w) => w.idle_score, pct: (w) => w.idle_pct },
};

const TILE_META: Record<ScoreComponentKey, { label: string; icon: MaterialSymbolName }> = {
  safety: { label: 'Safety', icon: 'shield' },
  efficiency: { label: 'Efficiency', icon: 'bolt' },
  idling: { label: 'Idling', icon: 'schedule' },
};

const ORDER: ScoreComponentKey[] = ['safety', 'efficiency', 'idling'];

/** Present values for one component across the weeks, oldest → newest, for a sparkline (undefined if < 2). */
function componentSpark(weeksAsc: MeScoreWeek[], key: ScoreComponentKey): number[] | undefined {
  const vals = weeksAsc.map((w) => SELECTORS[key].score(w)).filter((v): v is number => v != null);
  return vals.length >= 2 ? vals : undefined;
}

function buildTiles(weeksAsc: MeScoreWeek[], latest: MeScoreWeek, prev: MeScoreWeek | null): ScoreTile[] {
  return ORDER.map((key) => {
    const cur = SELECTORS[key].score(latest);
    const meta = TILE_META[key];
    return {
      key,
      label: meta.label,
      icon: meta.icon,
      value: cur == null ? '—' : String(Math.round(cur)),
      spark: componentSpark(weeksAsc, key),
      trend: trendFromDelta(roundedDelta(cur, prev ? SELECTORS[key].score(prev) : null)),
    };
  });
}

function weightPctLabel(weight: number, weights: PerformanceWeightsView): string {
  const total = weights.safety + weights.efficiency + weights.idling;
  const pct = total > 0 ? Math.round((weight / total) * 100) : 0;
  return `${pct}%`;
}

/** The component giving up the most weighted ground vs the fleet — the driver's best place to gain. */
function coachingLine(latest: MeScoreWeek, weights: PerformanceWeightsView): string {
  const weightOf: Record<ScoreComponentKey, number> = {
    safety: weights.safety,
    efficiency: weights.efficiency,
    idling: weights.idling,
  };
  let worst: { key: ScoreComponentKey; basis: number; opportunity: number } | null = null;
  for (const key of ORDER) {
    const score = SELECTORS[key].score(latest);
    if (score == null) continue; // a missing feed isn't a coaching target
    const pct = SELECTORS[key].pct(latest);
    const basis = pct ?? score;
    const opportunity = weightOf[key] * (100 - basis);
    if (!worst || opportunity > worst.opportunity) worst = { key, basis, opportunity };
  }
  if (!worst || worst.basis >= 85) {
    return "You're strong across the board — keep it steady to hold your rank.";
  }
  const wpct = weightPctLabel(weightOf[worst.key], weights);
  switch (worst.key) {
    case 'safety':
      return `Safety is ${wpct} of your grade and your biggest lever right now — smooth, incident-free miles move it most.`;
    case 'efficiency':
      return `Efficiency is your best opportunity this week — smoother acceleration and braking lifts it.`;
    case 'idling':
      return `Idling is your best opportunity this week — trimming avoidable idle time raises this sub-score directly.`;
  }
}

const INELIGIBLE_NOTES: Record<string, string> = {
  below_min_miles:
    "This week didn't qualify for ranking — under the weekly minimum miles. Your sub-scores below still count as coaching.",
  below_min_hours:
    "This week didn't qualify for ranking — under the weekly minimum drive hours. Your sub-scores below still count as coaching.",
  no_safety: "This week didn't qualify for ranking — no Safety score was available yet.",
};

function ineligibleNote(reason: string | null): string {
  return (
    (reason ? INELIGIBLE_NOTES[reason] : undefined) ??
    "This week isn't ranked yet — check back once it settles."
  );
}

export function buildScoreView(data: MeScoreResponse | undefined): ScoreView {
  const weeks = data?.weeks ?? [];
  const latest = weeks[0];
  if (!latest || !data) {
    return {
      state: 'empty',
      weekLabel: null,
      score: null,
      rankLabel: null,
      isWinner: false,
      trend: null,
      tiles: [],
      coaching: null,
      ineligibleNote: null,
    };
  }

  const prev = weeks[1] ?? null;
  const weeksAsc = [...weeks].reverse();
  const weekLabel = weekRangeLabel(latest.week_start, latest.week_end);
  const tiles = buildTiles(weeksAsc, latest, prev);

  const ranked = latest.eligible && latest.week_final != null;
  if (!ranked) {
    return {
      state: 'ineligible',
      weekLabel,
      score: null,
      rankLabel: null,
      isWinner: false,
      trend: null,
      tiles,
      coaching: null,
      ineligibleNote: ineligibleNote(latest.ineligible_reason),
    };
  }

  return {
    state: 'ready',
    weekLabel,
    score: Math.round(latest.week_final!),
    rankLabel: rankLabel(latest.rank, latest.cohort_size),
    isWinner: latest.is_winner,
    trend: trendFromDelta(roundedDelta(latest.week_final, prev?.week_final ?? null), ' vs last week') ?? null,
    tiles,
    coaching: coachingLine(latest, data.weights),
    ineligibleNote: null,
  };
}

/** The compact Home "This week" read — shares the ['me','score'] cache with the Score tab. */
export function homeScoreSummary(data: MeScoreResponse | undefined): HomeScoreSummary | null {
  const weeks = data?.weeks ?? [];
  const latest = weeks[0];
  if (!latest) return null;
  const prev = weeks[1] ?? null;
  const weeksAsc = [...weeks].reverse();
  const finals = weeksAsc.map((w) => w.week_final).filter((v): v is number => v != null);
  const rank = latest.rank;
  const cohort = latest.cohort_size;
  return {
    scoreValue: latest.week_final == null ? '—' : String(Math.round(latest.week_final)),
    scoreSpark: finals.length >= 2 ? finals : undefined,
    scoreTrend: trendFromDelta(roundedDelta(latest.week_final, prev?.week_final ?? null)),
    rankValue: rank == null ? '—' : `#${rank}`,
    rankUnit: rank != null && cohort != null && cohort > 0 ? `of ${cohort}` : undefined,
  };
}
