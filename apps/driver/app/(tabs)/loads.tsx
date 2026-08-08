import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  Banner,
  EmptyState,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Skeleton,
} from '@/components';
import { LoadCard } from '@/features/loads/LoadCard';
import { CurrentLoadCard } from '@/features/loads/CurrentLoadCard';
import { bucketLoads, toActive, toSummary } from '@/features/loads/loadViewModel';
import { useLoads } from '@/features/loads/useLoads';
import { useFeatures } from '@/session/useFeatures';

type Bucket = 'upcoming' | 'current' | 'previous';

const EMPTY: Record<Bucket, { title: string; subtitle: string }> = {
  upcoming: {
    title: 'No upcoming loads',
    subtitle: 'New assignments appear here once dispatch releases them.',
  },
  current: {
    title: 'Nothing in transit',
    subtitle: 'Accept an upcoming load and start it to see it here.',
  },
  previous: {
    title: 'No finished loads yet',
    subtitle: 'Delivered runs stay here for your records.',
  },
};

/**
 * Assignments (D51 — the tab reads "Loads", the page reads Assignments). Upcoming · Current ·
 * Previous, on real data. Only loads dispatch approved and released ever reach this list — the
 * server applies the same predicate the RLS policy does, so there is no client-side idea of a
 * hidden load to get wrong (D45).
 */
export default function Loads() {
  const router = useRouter();
  const features = useFeatures();
  const enabled = features.enabled('tab.loads');
  const { data, isPending, isError, error, refetch } = useLoads(enabled);
  const buckets = bucketLoads(data?.loads ?? []);
  // Land on whatever the driver is actually doing.
  const [bucket, setBucket] = useState<Bucket>(buckets.current.length > 0 ? 'current' : 'upcoming');

  const rows = buckets[bucket];
  const showSkeletons = isPending && !data;

  if (features.isLoaded && !enabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen>
        <ScreenHeader title="Loads" subtitle="Current work and released assignments" />
        <Skeleton className="h-[180px] w-full rounded-xl" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Loads" subtitle="Current work and released assignments" />
      <OfflineBanner />

      <SegmentedControl<Bucket>
        value={bucket}
        onChange={setBucket}
        options={[
          { label: 'Current', value: 'current' },
          { label: `Upcoming${buckets.upcoming.length ? ` ${buckets.upcoming.length}` : ''}`, value: 'upcoming' },
          { label: 'History', value: 'previous' },
        ]}
      />

      {isError && !data ? (
        <Banner
          tone="danger"
          message={error.message || 'Could not load your assignments.'}
          actionLabel="Retry"
          onAction={() => void refetch()}
        />
      ) : null}

      {showSkeletons ? (
        <View className="gap-3">
          <Skeleton className="h-[180px] w-full rounded-xl" />
          <Skeleton className="h-[180px] w-full rounded-xl" />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState icon="local_shipping" title={EMPTY[bucket].title} subtitle={EMPTY[bucket].subtitle} />
      ) : bucket === 'current' ? (
        rows.map((load) => (
          <CurrentLoadCard
            key={load.id}
            load={toActive(load)}
            onNavigate={() => router.push(`/loads/${load.id}` as never)}
            onOpen={() => router.push(`/loads/${load.id}` as never)}
          />
        ))
      ) : (
        rows.map((load) => (
          <LoadCard
            key={load.id}
            load={toSummary(load)}
            onPress={() => router.push(`/loads/${load.id}` as never)}
          />
        ))
      )}
    </Screen>
  );
}
