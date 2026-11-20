import { Pressable, View } from 'react-native';
import { AppText, GroupedList, ListRow } from '@/components';
import type { HomeScoreSummary } from '@/features/score/scoreModel';
import { haptics } from '@/lib/haptics';
import { ui } from '@/theme/classes';

/**
 * The driver's own score on Today (D-DB17), as rows on the canvas (the mock's screen 1): this week's
 * grade with the fleet rank under it and the change on the right, then the earlier weeks. It sits
 * near the BOTTOM on purpose: a score matters to a driver, but never more than the stop ahead.
 *
 * Direction B drew this as a card with an eight-week sparkline. The sparkline is gone: the weeks under
 * it carry the same numbers in a form a driver can read at a glance, and the card is D-DV7's
 * "card around rows". The data is unchanged (`homeScoreSummary`).
 */
export function ScoreRows({ score, onOpen }: { score: HomeScoreSummary; onOpen: () => void }) {
  const rank = [score.rankValue, score.rankUnit].filter(Boolean).join(' ');
  return (
    <GroupedList>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Your score this week, ${score.scoreValue}. Fleet rank ${rank}.${score.scoreTrend ? ` ${score.scoreTrend.label}.` : ''}`}
        onPress={() => {
          haptics.select();
          onOpen();
        }}
        className={`${ui.listRow} active:bg-surface-selected`}
      >
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <AppText variant="numericCompact">{score.scoreValue}</AppText>
            <AppText variant="supporting" tone="muted">this week</AppText>
          </View>
          <AppText variant="supporting" tone="secondary" tabular>{`Fleet rank ${rank}`}</AppText>
        </View>
        {score.scoreTrend ? (
          <AppText variant="supporting" weight="semibold" tone={score.scoreTrend.positive ? 'success' : 'warning'} tabular>
            {score.scoreTrend.label}
          </AppText>
        ) : null}
      </Pressable>
      {score.recentWeeks.slice(1).map((w) => (
        <ListRow
          key={w.key}
          title={w.label}
          right={
            <View className="items-end">
              <AppText variant="numericInline">{w.score}</AppText>
              <AppText variant="caption" tone="muted" tabular>{w.rank}</AppText>
            </View>
          }
        />
      ))}
    </GroupedList>
  );
}
