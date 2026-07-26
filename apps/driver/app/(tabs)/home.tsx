import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, ListRow, Screen, SectionLabel, StatTile } from '@/components';
import { CurrentLoadCard } from '@/features/loads/CurrentLoadCard';
import { SAMPLE_ACTIVE } from '@/features/loads/sampleLoads';
import { useSession } from '@/features/auth/SessionProvider';

function timeGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// Home (plan §13.5, D41): greeting → the CURRENT LOAD as the hero with one primary action →
// truck context → performance snapshot. Sample load/vehicle/score data until Phases 2/3/5 wire
// the caches; the greeting + identity are already live from the session.
export default function Home() {
  const router = useRouter();
  const { email } = useSession();
  const name = email?.split('@')[0] ?? 'Driver';
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-bold text-ink">
            {timeGreeting()}, {displayName}
          </Text>
          <Text className="text-sm text-ink-muted">{todayLabel()}</Text>
        </View>
        <Avatar name={displayName} size={44} />
      </View>

      <View className="flex-row items-center gap-2">
        <Badge label="All synced" tone="success" icon="cloud_done" />
        <Badge label="Online" tone="neutral" dot />
      </View>

      <SectionLabel>Current load</SectionLabel>
      <CurrentLoadCard
        load={SAMPLE_ACTIVE}
        onNavigate={() => router.push('/drive')}
        onOpen={() => router.push('/loads')}
      />

      <SectionLabel>My truck</SectionLabel>
      <ListRow
        icon="local_shipping"
        title="Unit 4471 — Freightliner Cascadia"
        subtitle="Odometer 438,795 mi · Diesel"
        right={<Badge label="Active" tone="success" dot />}
      />

      <SectionLabel>This week</SectionLabel>
      <View className="flex-row gap-3">
        <StatTile
          label="Score"
          value="87"
          trend={{ label: '+3 vs last wk', direction: 'up', positive: true }}
        />
        <StatTile label="Rank" value="#4" unit="of 23" icon="military_tech" />
      </View>

      <Text className="pt-1 text-center text-xs text-ink-subtle">
        Sample data — live loads, truck, and score wire up in the next phases.
      </Text>
    </Screen>
  );
}
