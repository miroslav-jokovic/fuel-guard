import { View } from 'react-native';
import { AppText, Card, Icon, Sparkline } from '@/components';
import type { HomeScoreSummary } from '@/features/score/scoreModel';

/**
 * The week, small. It sits at the BOTTOM of Today on purpose: a driver's score matters to them, but
 * never more than the stop they are driving to, and a metric tile at the top of an operational
 * screen is the single clearest tell of a dashboard pretending to be a tool.
 */
export function WeekStrip({ score, isWinner = false }: { score: HomeScoreSummary; isWinner?: boolean }) {
  return (
    <Card variant="flat">
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
    </Card>
  );
}
