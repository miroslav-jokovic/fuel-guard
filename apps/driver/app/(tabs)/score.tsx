import { Text, View } from 'react-native';
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  Screen,
  ScoreRing,
  ScreenHeader,
  Skeleton,
  StatTile,
} from '@/components';
import { buildScoreView } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';

/**
 * My Score (plan §13.5 / Phase 5): the driver's own weekly grade, wired to their frozen
 * driver_performance_weeks via `GET /api/me/score`. The animated ring is this week's grade, the three
 * sub-scores carry 7-week sparklines and week-over-week trends, and one plain-language coaching line
 * points at the weakest weighted component. Cached-first, so a cold start with no signal still renders
 * last settled week; skeletons only when nothing is cached. A week that didn't qualify still shows its
 * sub-scores (coaching) with a note explaining why it isn't ranked (docs/16 §3.2).
 */
export default function Score() {
  const q = useDriverScore();
  const view = buildScoreView(q.data);
  const loading = q.isPending && !q.data;

  return (
    <Screen>
      <ScreenHeader title="My Score" subtitle={view.weekLabel ?? undefined} />

      {q.isError && !q.data ? (
        <Banner
          tone="danger"
          message={q.error.message || 'Could not load your score.'}
          actionLabel="Retry"
          onAction={() => void q.refetch()}
        />
      ) : null}

      {loading ? (
        <>
          <Skeleton className="h-[232px] w-full rounded-xl" />
          <View className="flex-row gap-3">
            <Skeleton className="h-[124px] flex-1 rounded-xl" />
            <Skeleton className="h-[124px] flex-1 rounded-xl" />
            <Skeleton className="h-[124px] flex-1 rounded-xl" />
          </View>
        </>
      ) : view.state === 'empty' ? (
        <EmptyState
          icon="speed"
          title="No score yet"
          subtitle="Your first weekly grade posts after your first full week on the road."
        />
      ) : (
        <>
          {view.state === 'ready' ? (
            <Card>
              <View className="items-center gap-3 py-2">
                <ScoreRing score={view.score ?? 0} sublabel="/ 100" />
                <View className="flex-row flex-wrap items-center justify-center gap-2">
                  {view.trend ? (
                    <Badge
                      label={view.trend.label}
                      tone={view.trend.positive ? 'success' : 'warning'}
                      icon={view.trend.direction === 'up' ? 'trending_up' : 'trending_down'}
                    />
                  ) : null}
                  {view.rankLabel ? (
                    view.isWinner ? (
                      <Badge label={`Rank ${view.rankLabel} — winner`} tone="success" icon="military_tech" />
                    ) : (
                      <Text className="text-sm font-sans-md text-ink-secondary">Rank {view.rankLabel}</Text>
                    )
                  ) : null}
                </View>
              </View>
            </Card>
          ) : (
            <Banner tone="info" message={view.ineligibleNote ?? "This week isn't ranked yet."} />
          )}

          <View className="flex-row gap-3">
            {view.tiles.map((t) => (
              <StatTile
                key={t.key}
                label={t.label}
                value={t.value}
                icon={t.icon}
                spark={t.spark}
                trend={t.trend}
              />
            ))}
          </View>

          {view.coaching ? <Banner tone="info" icon="bolt" message={view.coaching} /> : null}
        </>
      )}
    </Screen>
  );
}
