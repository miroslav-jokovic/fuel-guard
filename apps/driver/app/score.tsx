import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  AppText,
  Banner,
  GroupedList,
  ListRow,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  StatusBlock,
  TrendChart,
} from '@/components';
import { buildScoreView, type ScoreTile } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';
import { useFeatures } from '@/session/useFeatures';

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
  const query = useDriverScore(scoreEnabled);
  const view = buildScoreView(query.data);
  const loading = query.isPending && !query.data;

  if (features.isLoaded && !scoreEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen>
        <ScreenHeader display title="Score" onClose={() => router.back()} />
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

  // Visual 2026 V8: the week is the screen's status block (D-DV6): the score as its one figure, the
  // rank beside it, the change in its state colour, and the eight-week line inside the navy. The
  // title is the screen's own in the display face, with Close, instead of a navy hero.
  const trendTone = view.trend ? (view.trend.direction === 'up' ? 'live' : 'act') : 'live';

  return (
    <Screen padTop={false} flow="sections">
      {/* Always reachable from More and never a tab (D-DB14), so Close is unconditional. */}
      <ScreenHeader display title="Score" onClose={() => router.back()} />

      <Section>
        {/* A failed fetch shows only its banner below: "No score yet" would be a claim the app
            cannot make when it never got an answer. */}
        {loading ? (
          <Skeleton className="w-full rounded-xl" style={{ height: 220 }} />
        ) : query.isError && !query.data ? null : view.state === 'empty' ? (
          <StatusBlock context="Weekly score" subject="No score yet" place="Your first weekly grade posts after a full week on the road." />
        ) : view.state === 'ineligible' ? (
          <StatusBlock context={view.weekLabel ?? 'Weekly score'} subject="This week is not ranked" place={view.ineligibleNote ?? undefined} />
        ) : (
          <StatusBlock
            context={view.weekLabel ?? 'Weekly score'}
            figure={String(view.score ?? 0)}
            figureSuffix={view.rankLabel ? `${view.rankLabel} in your fleet` : undefined}
            live={view.trend ? view.trend.label : undefined}
            liveTone={trendTone}
          >
            <View className="pt-3">
              <TrendChart values={trend} />
            </View>
            {view.isWinner ? (
              <AppText variant="supporting" weight="semibold" tone="onHeroAct">Top score in your fleet this week</AppText>
            ) : null}
          </StatusBlock>
        )}
      </Section>

      {query.isError && !query.data ? (
        <Section>
          <Banner
            tone="danger"
            message={query.error.message || 'Could not load your score.'}
            actionLabel="Retry"
            onAction={() => void query.refetch()}
          />
        </Section>
      ) : null}

      {view.tiles.length > 0 ? (
        <Section title="What made the score">
          <GroupedList>
            {view.tiles.map((tile) => <ScoreRow key={tile.key} tile={tile} />)}
          </GroupedList>
        </Section>
      ) : null}

      {view.coaching ? (
        <Section title="Next opportunity">
          {/* The coaching line is the one thing here a driver can act on: an amber glyph (act, D-DV5)
              on a plain row, since one navy block per screen is the week's (D-DV6). */}
          <GroupedList>
            <ListRow icon="bolt" disc="caution" title={view.coaching} />
          </GroupedList>
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
