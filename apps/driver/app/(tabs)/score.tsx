import { Text, View } from 'react-native';
import { Badge, Banner, Card, Screen, ScoreRing, ScreenHeader, StatTile } from '@/components';

// My Score (Phase 5 shell): the driver's own weekly performance — animated score ring, the three
// sub-scores with 7-week sparklines (safety / efficiency / idling per DEFAULT_PERFORMANCE_SETTINGS
// weights), and a plain-language coaching line from the weakest component. Sample values until
// Phase 5 wires the self-read.
export default function Score() {
  return (
    <Screen>
      <ScreenHeader title="My Score" subtitle="Week of Jul 20 – 26" />

      <Card>
        <View className="items-center gap-3 py-2">
          <ScoreRing score={87} sublabel="/ 100" />
          <View className="flex-row items-center gap-3">
            <Badge label="+3 vs last week" tone="success" icon="trending_up" />
            <Text className="text-sm font-sans-md text-ink-secondary">Rank #4 of 23</Text>
          </View>
        </View>
      </Card>

      <View className="flex-row gap-3">
        <StatTile
          label="Safety"
          value="92"
          icon="shield"
          spark={[88, 90, 89, 91, 90, 92, 92]}
          trend={{ label: '+1', direction: 'up', positive: true }}
        />
        <StatTile
          label="Efficiency"
          value="84"
          icon="bolt"
          spark={[78, 80, 79, 82, 83, 84, 84]}
          trend={{ label: '+4', direction: 'up', positive: true }}
        />
        <StatTile
          label="Idling"
          value="79"
          icon="schedule"
          spark={[83, 82, 81, 80, 80, 79, 79]}
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
