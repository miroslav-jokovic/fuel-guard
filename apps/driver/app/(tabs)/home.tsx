import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Avatar,
  Badge,
  Banner,
  ListRow,
  NeedsAttentionNote,
  OfflineBanner,
  Screen,
  SectionLabel,
  Skeleton,
  StatTile,
} from '@/components';
import { CurrentLoadCard } from '@/features/loads/CurrentLoadCard';
import { SAMPLE_ACTIVE } from '@/features/loads/sampleLoads';
import { firstName, primaryVehicle, useDriverContext } from '@/features/home/useDriverContext';

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

function formatMiles(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Math.round(value).toLocaleString();
}

/**
 * Home (plan §13.5, reframed by D41): the driver's current load is the hero, with truck context and
 * a performance snapshot beneath. Cached-first — on a cold start with no signal this renders from
 * the persisted query cache; skeletons appear only when there is genuinely nothing cached yet, and
 * a failed refresh while cached data exists is silent (offline is normal, not an error).
 */
export default function Home() {
  const router = useRouter();
  const { data, isPending, isError, error, refetch } = useDriverContext();

  const driverName = firstName(data?.driver.full_name);
  const vehicle = primaryVehicle(data);
  const showSkeletons = isPending && !data;

  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          {showSkeletons ? (
            <>
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="mt-1 h-4 w-1/3" />
            </>
          ) : (
            <>
              <Text className="text-2xl font-sans-bold text-ink">
                {timeGreeting()}, {driverName}
              </Text>
              <Text className="text-sm text-ink-muted">{todayLabel()}</Text>
            </>
          )}
        </View>
        {showSkeletons ? (
          <Skeleton className="h-11 w-11 rounded-full" />
        ) : (
          <Avatar name={data?.driver.full_name ?? driverName} size={44} />
        )}
      </View>

      <OfflineBanner />
      <NeedsAttentionNote />

      {isError && !data ? (
        <Banner
          tone="danger"
          message={error.message || 'Could not load your profile.'}
          actionLabel="Retry"
          onAction={() => {
            void refetch();
          }}
        />
      ) : null}

      <SectionLabel>Current load</SectionLabel>
      <CurrentLoadCard
        load={SAMPLE_ACTIVE}
        onNavigate={() => router.push('/drive')}
        onOpen={() => router.push('/loads')}
      />

      <SectionLabel>My truck</SectionLabel>
      {showSkeletons ? (
        <Skeleton className="h-[60px] w-full rounded-xl" />
      ) : vehicle ? (
        <ListRow
          icon="local_shipping"
          title={`Unit ${vehicle.unit_number}${vehicle.make ? ` — ${vehicle.make}` : ''}${
            vehicle.model ? ` ${vehicle.model}` : ''
          }`}
          subtitle={`Odometer ${formatMiles(vehicle.current_odometer)} mi · ${vehicle.fuel_type}`}
          right={<Badge label="Assigned" tone="success" dot />}
        />
      ) : (
        <ListRow
          icon="local_shipping"
          title="No truck assigned"
          subtitle="Your dispatcher assigns your unit — it appears here"
        />
      )}

      <SectionLabel>This week</SectionLabel>
      <View className="flex-row gap-3">
        <StatTile
          label="Score"
          value="87"
          spark={[82, 84, 83, 85, 86, 86, 87]}
          trend={{ label: '+3 vs last wk', direction: 'up', positive: true }}
        />
        <StatTile label="Rank" value="#4" unit="of 23" icon="military_tech" />
      </View>

      <Text className="pt-1 text-center text-xs text-ink-subtle">
        Load and score data are samples — they wire up in the Loads and Performance phases.
      </Text>
    </Screen>
  );
}
