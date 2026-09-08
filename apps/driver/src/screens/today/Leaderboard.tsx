import { View } from 'react-native';
import { AppText, Card, Icon, Skeleton } from '@/components';
import type { LeaderboardView } from '@/features/score/leaderboardModel';

/**
 * The fleet leaderboard on Home (D-DB18): the latest ranked week's top five by first name and
 * grade, then the driver after a break if they placed lower. The viewer's row is the selected
 * surface with "(you)" in the name, so the highlight is never colour alone (D-DB9).
 *
 * It sits under the driver's own score card, not above it: the reference boards treat rank as a
 * motivator, and the honest order is "your week" first, "the fleet" second. Every value is the
 * API's projection — nothing here is computed from other drivers' rows, because the app never
 * receives them.
 */
export function Leaderboard({ view, loading = false }: { view: LeaderboardView; loading?: boolean }) {
  if (loading) return <Skeleton className="w-full rounded-xl" style={{ height: 232 }} />;

  return (
    <Card padded={false}>
      <View className="flex-row items-center gap-3 px-4 pt-4 pb-2">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-action-soft">
          <Icon name="military_tech" size={20} className="text-action-ink" />
        </View>
        <View className="flex-1 gap-0.5">
          <AppText variant="rowTitle">Fleet leaderboard</AppText>
          <AppText variant="supporting" tone="muted" numberOfLines={1}>
            {view.weekLabel ?? 'No ranked week yet'}
          </AppText>
        </View>
      </View>

      {view.state === 'empty' ? (
        <AppText variant="supporting" tone="muted" className="px-4 pb-4">{view.myPlace}</AppText>
      ) : (
        <>
          {view.rows.map((row) => (
            <View key={row.key}>
              {row.afterGap ? (
                <View className="flex-row items-center gap-3 px-4 py-1">
                  <View className="h-px flex-1 bg-edge-subtle" />
                  <AppText variant="caption" tone="subtle">…</AppText>
                  <View className="h-px flex-1 bg-edge-subtle" />
                </View>
              ) : null}
              <View className={`min-h-12 flex-row items-center gap-3 px-4 ${row.isMe ? 'bg-surface-selected' : ''}`}>
                <AppText variant="supporting" tone={row.isMe ? 'accent' : 'muted'} className="w-10 font-ui-md" tabular>
                  {row.rank}
                </AppText>
                <AppText variant="rowTitle" tone={row.isMe ? 'accent' : 'primary'} className="flex-1" numberOfLines={1}>
                  {row.name}
                </AppText>
                <AppText variant="numericInline" tone={row.isMe ? 'accent' : 'primary'}>{row.score}</AppText>
              </View>
            </View>
          ))}
          <View className="px-4 pb-4 pt-2">
            <AppText variant="caption" tone="muted">{view.myPlace}</AppText>
          </View>
        </>
      )}
    </Card>
  );
}
