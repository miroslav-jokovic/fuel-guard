import { View } from 'react-native';
import { AppText, Card, Icon, Sparkline } from '@/components';
import type { HomeScoreSummary } from '@/features/score/scoreModel';

/**
 * The driver's score on Home (D-DB17): this week's grade and fleet rank, the eight-week line, and
 * the last four weeks as a rank list. It sits at the BOTTOM of Home on purpose: a driver's score
 * matters to them, but never more than the stop they are driving to, and a metric tile at the top
 * of an operational screen is the single clearest tell of a dashboard pretending to be a tool.
 *
 * Every rank here is the driver's own. A fleet leaderboard is not drawn because the API does not
 * expose one to a driver (driverContract.ts: RLS hides every other driver's row, and "#4 of 23" is
 * exactly what can be known without leaking it). Whether one should exist is §7 Q-DB7.
 *
 * The whole card opens the Score screen, which carries what made the grade.
 */
export function WeekStrip({
  score,
  isWinner = false,
  onOpen,
}: {
  score: HomeScoreSummary;
  isWinner?: boolean;
  onOpen?: () => void;
}) {
  return (
    <Card onPress={onOpen}>
      <View className="flex-row items-center gap-4">
        <View className="gap-0.5">
          <AppText variant="caption" tone="muted">Driver score</AppText>
          <AppText variant="numericCompact">{score.scoreValue}</AppText>
          {score.scoreTrend ? (
            <AppText variant="caption" tone={score.scoreTrend.positive ? 'success' : 'warning'}>
              {score.scoreTrend.label}
            </AppText>
          ) : null}
        </View>
        <View className="h-8 flex-1">
          {score.scoreSpark ? <Sparkline data={score.scoreSpark} height={32} /> : null}
        </View>
        <View className="items-end gap-0.5">
          <AppText variant="caption" tone="muted">Fleet rank</AppText>
          <AppText variant="numericCompact">{score.rankValue}</AppText>
          {score.rankUnit ? <AppText variant="caption" tone="muted">{score.rankUnit}</AppText> : null}
        </View>
      </View>

      {isWinner ? (
        <View className="flex-row items-center gap-2 pt-1">
          <Icon name="military_tech" size={18} className="text-action-ink" />
          <AppText variant="supporting" tone="action">Top score in your fleet</AppText>
        </View>
      ) : null}

      {score.recentWeeks.length > 1 ? (
        <View className="pt-2">
          <View className="h-px bg-edge-subtle" />
          {score.recentWeeks.map((w) => (
            <View key={w.key} className="min-h-11 flex-row items-center gap-3">
              <AppText variant="supporting" tone="secondary" className="flex-1" numberOfLines={1}>{w.label}</AppText>
              <AppText variant="supporting" className="font-ui-md" tabular>{w.score}</AppText>
              <AppText variant="supporting" tone="muted" className="w-24 text-right" tabular numberOfLines={1}>{w.rank}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
