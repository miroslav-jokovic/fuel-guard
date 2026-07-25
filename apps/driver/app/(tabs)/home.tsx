import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Banner, Button, Card, EmptyState, Icon, Screen, StatTile } from '@/components';

export default function Home() {
  const router = useRouter();
  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <Avatar name="Miki Jokovic" />
        <View className="flex-1">
          <Text className="text-lg font-semibold text-ink">Good morning, Miki</Text>
          <Text className="text-sm text-ink-muted">Silvicom Inc.</Text>
        </View>
      </View>

      <Banner tone="success" message="All synced." />

      <Card>
        <View className="flex-row items-center gap-2">
          <Icon name="local_shipping" size={18} className="text-ink-muted" />
          <Text className="text-xs uppercase tracking-wide text-ink-muted">Assigned vehicle</Text>
        </View>
        <Text className="text-lg font-semibold text-ink">Unit 4471 — Freightliner Cascadia</Text>
        <View className="flex-row gap-3 pt-2">
          <StatTile label="Odometer" value="438,795" unit="mi" />
          <StatTile label="Tank" value="150" unit="gal" />
        </View>
      </Card>

      <Button label="Log fill-up" icon="local_gas_station" iconFill variant="primary" onPress={() => router.push('/log-fuel')} />

      <View className="gap-2">
        <Text className="text-xs uppercase tracking-wide text-ink-muted">Recent activity</Text>
        <Card>
          <EmptyState icon="receipt_long" title="No fill-ups yet" subtitle="Tap “Log fill-up” to record your first — about 30 seconds." />
        </Card>
      </View>
    </Screen>
  );
}
