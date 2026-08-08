import { View, useWindowDimensions } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  AppText,
  Banner,
  EmptyState,
  GroupedList,
  Icon,
  Progress,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  Sparkline,
} from '@/components';
import { buildScoreView, type ScoreTile } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';
import { useFeatures } from '@/session/useFeatures';
import { layout } from '@/theme/tokens';

function ScoreTrend({ tile }: { tile: ScoreTile }) {
  if (!tile.trend) return <AppText variant="caption" tone="muted">No week-over-week change yet</AppText>;
  return (
    <View className="flex-row items-center gap-1">
      <Icon
        name={tile.trend.direction === 'up' ? 'trending_up' : 'trending_down'}
        size={14}
        className={tile.trend.positive ? 'text-success' : 'text-warning'}
      />
      <AppText variant="caption" tone={tile.trend.positive ? 'success' : 'warning'}>{tile.trend.label}</AppText>
    </View>
  );
}

function ScoreMetricRow({ tile }: { tile: ScoreTile }) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= layout.largeTextBreakpoint;
  if (largeText) {
    return (
      <View className="min-h-[64px] gap-2 bg-surface px-4 py-3">
        <View className="flex-row items-start gap-3">
          <View className="w-6 items-center"><Icon name={tile.icon} size={20} className="text-ink-secondary" /></View>
          <View className="flex-1 gap-0.5">
            <AppText variant="rowTitle">{tile.label}</AppText>
            <ScoreTrend tile={tile} />
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="w-6" />
          <AppText variant="numericCompact" tabular>{tile.value}</AppText>
        </View>
      </View>
    );
  }
  return (
    <View className="min-h-[64px] flex-row items-center gap-3 bg-surface px-4 py-3">
      <View className="w-6 items-center"><Icon name={tile.icon} size={20} className="text-ink-secondary" /></View>
      <View className="flex-1 gap-0.5">
        <AppText variant="rowTitle">{tile.label}</AppText>
        <ScoreTrend tile={tile} />
      </View>
      {tile.spark ? <View className="w-20"><Sparkline data={tile.spark} height={18} /></View> : null}
      <AppText variant="numericCompact" tabular>{tile.value}</AppText>
    </View>
  );
}

export default function Score() {
  const router = useRouter();
  const features = useFeatures();
  const scoreEnabled = features.enabled('tab.score');
  const { scoreDetailTab } = features;
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= layout.largeTextBreakpoint;
  const query = useDriverScore(scoreEnabled);
  const view = buildScoreView(query.data);
  const loading = query.isPending && !query.data;

  if (features.isLoaded && !scoreEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen>
        <ScreenHeader title="Score" subtitle="Weekly performance" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Score"
        subtitle={view.weekLabel ?? 'Weekly performance'}
        onBack={scoreDetailTab ? undefined : () => router.back()}
      />

      {query.isError && !query.data ? (
        <Banner
          tone="danger"
          message={query.error.message || 'Could not load your score.'}
          actionLabel="Retry"
          onAction={() => void query.refetch()}
        />
      ) : null}

      {loading ? (
        <>
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
        </>
      ) : view.state === 'empty' ? (
        <EmptyState title="No score yet" subtitle="Your first weekly grade posts after a full week on the road." />
      ) : (
        <>
          {view.state === 'ready' ? (
            <View className="gap-3 rounded-2xl border border-edge bg-surface p-4">
              <View className={largeText ? 'gap-3' : 'flex-row items-end gap-4'}>
                <View className="flex-1 gap-0.5">
                  <AppText variant="caption" tone="muted">Weekly score</AppText>
                  <View className="flex-row items-baseline gap-1">
                    <AppText variant="numericHero" tabular>{String(view.score ?? 0)}</AppText>
                    <AppText variant="supporting" tone="muted">/ 100</AppText>
                  </View>
                </View>
                <View className={`${largeText ? 'items-start' : 'items-end'} gap-1`}>
                  {view.rankLabel ? (
                    <>
                      <AppText variant="caption" tone="muted">Fleet rank</AppText>
                      <AppText variant="navigationTitle">{view.rankLabel}</AppText>
                    </>
                  ) : null}
                  {view.trend ? (
                    <View className="flex-row items-center gap-1">
                      <Icon
                        name={view.trend.direction === 'up' ? 'trending_up' : 'trending_down'}
                        size={15}
                        className={view.trend.positive ? 'text-success' : 'text-warning'}
                      />
                      <AppText variant="caption" tone={view.trend.positive ? 'success' : 'warning'}>{view.trend.label}</AppText>
                    </View>
                  ) : null}
                </View>
              </View>
              <Progress value={(view.score ?? 0) / 100} />
              {view.isWinner ? (
                <View className="flex-row items-center gap-2 border-t border-edge-subtle pt-3">
                  <Icon name="military_tech" size={18} className="text-success" />
                  <AppText variant="supporting" tone="success" className="font-medium">Top score in your fleet this week</AppText>
                </View>
              ) : null}
            </View>
          ) : (
            <Banner tone="info" message={view.ineligibleNote ?? 'This week is not ranked yet.'} />
          )}

          <SectionLabel>Score breakdown</SectionLabel>
          <GroupedList>
            {view.tiles.map((tile) => <ScoreMetricRow key={tile.key} tile={tile} />)}
          </GroupedList>

          {view.coaching ? (
            <>
              <SectionLabel>Next opportunity</SectionLabel>
              <Banner tone="info" icon="bolt" message={view.coaching} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
