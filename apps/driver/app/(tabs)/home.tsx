import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Avatar,
  Banner,
  EmptyState,
  NeedsAttentionNote,
  OfflineBanner,
  Screen,
  SectionLabel,
  Skeleton,
  StatTile,
} from '@/components';
import { CurrentLoadCard } from '@/features/loads/CurrentLoadCard';
import { LoadCard } from '@/features/loads/LoadCard';
import { bucketLoads, toActive, toSummary } from '@/features/loads/loadViewModel';
import { useLoads } from '@/features/loads/useLoads';
import { DutyCard } from '@/features/duty/DutyCard';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { firstName, useDriverContext } from '@/features/home/useDriverContext';

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

/**
 * Home (plan §13.5, reframed by D41 and D51): what the driver needs in a two-second glance —
 * who they are, what they are driving, and what they are working. Cached-first, so a cold start in
 * airplane mode renders real data; skeletons appear only when there is genuinely nothing cached.
 */
export default function Home() {
  const router = useRouter();
  const driver = useDriverContext();
  const shift = useShift();
  const loads = useLoads();

  const duty = dutyView(shift.data);
  const buckets = bucketLoads(loads.data?.loads ?? []);
  const current = buckets.current[0] ?? null;
  const nextUp = buckets.upcoming[0] ?? null;

  const driverName = firstName(driver.data?.driver.full_name);
  const showSkeletons = driver.isPending && !driver.data;

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
          <Avatar name={driver.data?.driver.full_name ?? driverName} size={44} />
        )}
      </View>

      <OfflineBanner />
      <NeedsAttentionNote />

      {driver.isError && !driver.data ? (
        <Banner
          tone="danger"
          message={driver.error.message || 'Could not load your profile.'}
          actionLabel="Retry"
          onAction={() => void driver.refetch()}
        />
      ) : null}

      <SectionLabel>Your day</SectionLabel>
      <DutyCard
        duty={duty}
        loading={shift.isPending && !shift.data}
        onStart={() => router.push('/duty/check-in' as never)}
        onChange={() => router.push('/duty/check-in?mode=swap' as never)}
      />

      <SectionLabel>{current ? 'Current load' : 'Next load'}</SectionLabel>
      {loads.isPending && !loads.data ? (
        <Skeleton className="h-[220px] w-full rounded-xl" />
      ) : current ? (
        <CurrentLoadCard
          load={toActive(current)}
          onNavigate={() => router.push(`/loads/${current.id}` as never)}
          onOpen={() => router.push(`/loads/${current.id}` as never)}
        />
      ) : nextUp ? (
        <LoadCard load={toSummary(nextUp)} onPress={() => router.push(`/loads/${nextUp.id}` as never)} />
      ) : (
        <EmptyState
          icon="local_shipping"
          title="Nothing assigned yet"
          subtitle="New loads from dispatch appear here as soon as they're released."
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
        Score is a sample until the Performance phase.
      </Text>
    </Screen>
  );
}
