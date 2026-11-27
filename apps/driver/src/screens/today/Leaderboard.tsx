import { View } from 'react-native';
import { AppText, GroupedList, Skeleton } from '@/components';
import type { LeaderboardView } from '@/features/score/leaderboardModel';
import { ui } from '@/theme/classes';

/**
 * The fleet leaderboard on Today (D-DB18): the latest ranked week's top five by first name and
 * grade, then the driver after a break if they placed lower. The viewer's row says "(you)" in its
 * name and is set in the live cyan, so the highlight is never colour alone (D-DB9).
 *
 * It sits under the driver's own score, not above it: "your week" first, "the fleet" second. Every
 * value is the API's projection; nothing here is computed from other drivers' rows, because the app
 * never receives them. Since V5 the board is rows on the canvas (D-DV7) under its own section label,
 * which carries the week, instead of a card with a medal disc (D-DV5: no decorative colour).
 */
export function Leaderboard({ view, loading = false }: { view: LeaderboardView; loading?: boolean }) {
  if (loading) return <Skeleton className="w-full rounded-xl" style={{ height: 232 }} />;
  if (view.state === 'empty') {
    return <AppText variant="supporting" tone="muted">{view.myPlace}</AppText>;
  }

  return (
    <View className="gap-2">
      <GroupedList>
        {view.rows.map((row) => (
          <View key={row.key}>
            {row.afterGap ? (
              <AppText variant="caption" tone="subtle" className="px-4 py-1" accessibilityLabel="Gap in the ranking">…</AppText>
            ) : null}
            <View className={ui.listRow} accessible accessibilityLabel={`${row.rank}, ${row.name}, ${row.score}`}>
              <AppText weight="medium" variant="supporting" tone={row.isMe ? 'accent' : 'muted'} className="w-10" tabular>
                {row.rank}
              </AppText>
              <AppText variant="rowTitle" tone={row.isMe ? 'accent' : 'primary'} className="flex-1" numberOfLines={1}>
                {row.name}
              </AppText>
              <AppText variant="numericInline" tone={row.isMe ? 'accent' : 'primary'}>{row.score}</AppText>
            </View>
          </View>
        ))}
      </GroupedList>
      <AppText variant="caption" tone="muted">{view.myPlace}</AppText>
    </View>
  );
}
