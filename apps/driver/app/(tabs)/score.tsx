import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  AppText,
  Badge,
  Banner,
  Card,
  Icon,
  ListRow,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  TrendChart,
} from '@/components';
import { buildScoreView, type ScoreTile } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';
import { useFeatures } from '@/session/useFeatures';

const TILE_TONE = { safety: 'success', efficiency: 'info', idling: 'action' } as const;

/**
 * The driver's week. The hero is the number and the trend; the sheet is what made it and what to do
 * next — in that order, because a driver who opens this screen wants their grade first and the
 * arithmetic second.
 *
 * Every figure here is a stored fact. There are no projections, no "on track for" and no target the
 * driver did not set: `scoreModel` refuses to fabricate, and this screen only renders what it
 * returns.
 */
export default function Score() {
  const router = useRouter();
  const features = useFeatures();
  const scoreEnabled = features.enabled('tab.score');
  const { scoreDetailTab } = features;
  const query = useDriverScore(scoreEnabled);
  const view = buildScoreView(query.data);
  const loading = query.isPending && !query.data;

  if (features.isLoaded && !scoreEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen>
        <ScreenHeader title="Score" subtitle="Weekly performance" />
        <Skeleton className="w-full rounded-xl" style={{ height: 144 }} />
      </Screen>
    );
  }

  // Oldest → newest, ranked weeks only: an unranked week has no grade to plot, and interpolating
  // across the gap would draw a line through a week that was never scored.
  const trend = [...(query.data?.weeks ?? [])]
    .reverse()
    .map((w) => w.week_final)
    .filter((v): v is number => v != null)
    .map((v) => Math.round(v));

  const hero = (
    <View className="gap-4">
      <View className="flex-row items-start gap-3">
        <View className="flex-1 gap-1">
          <AppText variant="screenTitle" tone="onHero" accessibilityRole="header">Score</AppText>
          <AppText variant="supporting" tone="onHeroSecondary">{view.weekLabel ?? 'Weekly performance'}</AppText>
        </View>
        {scoreDetailTab ? null : (
          <AppText variant="supporting" tone="onHeroSecondary" onPress={() => router.back()}>Close</AppText>
        )}
      </View>

      {loading ? (
        <Skeleton className="w-full rounded-xl" style={{ height: 220 }} />
      ) : view.state === 'empty' ? (
        <Card variant="hero">
          <AppText variant="navigationTitle" tone="onHero">No score yet</AppText>
          <AppText variant="supporting" tone="onHeroSecondary">
            Your first weekly grade posts after a full week on the road.
          </AppText>
        </Card>
      ) : view.state === 'ineligible' ? (
        <View className="gap-2 rounded-xl bg-hero-tile p-4">
          <AppText variant="rowTitle" tone="onHero">This week is not ranked</AppText>
          <AppText variant="supporting" tone="onHeroSecondary">{view.ineligibleNote}</AppText>
        </View>
      ) : (
        <>
          <View className="flex-row items-end gap-3">
            <View className="gap-0.5">
              <AppText variant="caption" tone="onHeroMuted">Weekly score</AppText>
              <AppText variant="numericHero" tone="onHero">{String(view.score ?? 0)}</AppText>
            </View>
            <View className="flex-1 gap-1 pb-2">
              {view.trend ? (
                <Badge
                  label={`${view.trend.label} vs last week`}
                  tone="action"
                  icon={view.trend.direction === 'up' ? 'trending_up' : 'trending_down'}
                />
              ) : null}
              {view.rankLabel ? (
                <AppText variant="caption" tone="onHeroSecondary">{view.rankLabel} in your fleet</AppText>
              ) : null}
            </View>
          </View>
          <TrendChart values={trend} />
          {view.isWinner ? (
            <View className="flex-row items-center gap-2">
              <Icon name="military_tech" size={18} className="text-action" />
              <AppText variant="supporting" tone="onHero">Top score in your fleet this week</AppText>
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <Screen hero={hero} flow="sections">
      {query.isError && !query.data ? (
        <Section first>
          <Banner
            tone="danger"
            message={query.error.message || 'Could not load your score.'}
            actionLabel="Retry"
            onAction={() => void query.refetch()}
          />
        </Section>
      ) : null}

      {view.tiles.length > 0 ? (
        <Section title="What made the score" first={!query.isError || Boolean(query.data)}>
          <Card variant="flat" padded={false}>
            {view.tiles.map((tile, index) => (
              <View key={tile.key}>
                <ScoreRow tile={tile} />
                {index < view.tiles.length - 1 ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {view.coaching ? (
        <Section title="Next opportunity">
          {/* The one hero-coloured card on a sheet: the coaching line is the single thing on this
              screen a driver can act on, and it earns the emphasis (D-DB2). */}
          <View className="gap-2 rounded-xl bg-hero p-5">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-action-soft">
              <Icon name="bolt" size={20} className="text-action-ink" />
            </View>
            <AppText variant="rowTitle" tone="onHero">Next opportunity</AppText>
            <AppText variant="supporting" tone="onHeroSecondary">{view.coaching}</AppText>
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

/**
 * One component: what it is, what it measures, what it carries of the grade, and where it went.
 * The sparkline is gone from these rows — the eight-week line above carries the history, and three
 * more tiny lines beside it was three answers to a question nobody asked twice.
 */
function ScoreRow({ tile }: { tile: ScoreTile }) {
  return (
    <ListRow
      title={tile.label}
      subtitle={`${tile.definition} · ${tile.weightLabel} of your grade`}
      icon={tile.icon}
      disc={TILE_TONE[tile.key]}
      right={
        <View className="items-end gap-0.5">
          <AppText variant="numericInline">{tile.value}</AppText>
          {tile.trend ? (
            <AppText variant="caption" tone={tile.trend.positive ? 'success' : 'warning'}>
              {tile.trend.label}
            </AppText>
          ) : null}
        </View>
      }
    />
  );
}
