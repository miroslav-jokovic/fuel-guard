import { Text, View } from 'react-native';
import { Badge, Banner, Card, Screen, ScreenHeader, StatTile } from '@/components';

// My Score (Phase 5 shell): the driver's own weekly performance — hero numeral, the three
// sub-scores (safety / efficiency / idling per DEFAULT_PERFORMANCE_SETTINGS weights), and a
// plain-language coaching line from the weakest component. Sample values until Phase 5 wires
// the self-read.
export default function Score() {
  return (
    <Screen>
      <ScreenHeader title="My Score" subtitle="Week of Jul 20 – 26" />

      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Weekly score
          </Text>
          <Badge label="+3 vs last week" tone="success" icon="trending_up" />
        </View>
        <View className="flex-row items-baseline gap-2 pt-1">
          <Text
            className="font-bold text-ink"
            style={{ fontSize: 64, lineHeight: 68, fontVariant: ['tabular-nums'], includeFontPadding: false }}
          >
            87
          </Text>
          <Text className="text-lg text-ink-muted">/ 100</Text>
          <View className="flex-1" />
          <Text className="text-sm font-medium text-ink-secondary">Rank #4 of 23</Text>
        </View>
      </Card>

      <View className="flex-row gap-3">
        <StatTile
          label="Safety"
          value="92"
          icon="shield"
          trend={{ label: '+1', direction: 'up', positive: true }}
        />
        <StatTile
          label="Efficiency"
          value="84"
          icon="bolt"
          trend={{ label: '+4', direction: 'up', positive: true }}
        />
        <StatTile
          label="Idling"
          value="79"
          icon="schedule"
          trend={{ label: '-2', direction: 'down', positive: false }}
        />
      </View>

      <Banner
        tone="info"
        icon="bolt"
        message="Idling is your biggest opportunity — cutting ~15 min/day would lift your score about 3 points."
      />

      <Text className="pt-1 text-center text-xs text-ink-subtle">
        Sample data — live scoring arrives with the Performance phase.
      </Text>
    </Screen>
  );
}
