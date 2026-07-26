import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { EmptyState, Screen, ScreenHeader, SegmentedControl } from '@/components';
import { LoadCard } from '@/features/loads/LoadCard';
import { CurrentLoadCard } from '@/features/loads/CurrentLoadCard';
import {
  SAMPLE_ACTIVE,
  SAMPLE_PREVIOUS,
  SAMPLE_UPCOMING,
} from '@/features/loads/sampleLoads';

type Bucket = 'upcoming' | 'current' | 'previous';

// The Loads surface (Phase 3 shell): Upcoming / Current / Previous, JB-Hunt-style. Accept +
// per-stop photo capture attach here when the Phase-3 endpoints land; sample data until then.
export default function Loads() {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>('current');
  const noop = () => undefined; // detail route lands with Phase 3

  return (
    <Screen>
      <ScreenHeader title="Loads" subtitle="Your assignments" />
      <SegmentedControl<Bucket>
        value={bucket}
        onChange={setBucket}
        options={[
          { label: 'Upcoming', value: 'upcoming' },
          { label: 'Current', value: 'current' },
          { label: 'Previous', value: 'previous' },
        ]}
      />

      {bucket === 'current' ? (
        <CurrentLoadCard
          load={SAMPLE_ACTIVE}
          onNavigate={() => router.push('/drive')}
          onOpen={noop}
        />
      ) : null}

      {bucket === 'upcoming' ? (
        SAMPLE_UPCOMING.length > 0 ? (
          SAMPLE_UPCOMING.map((l) => <LoadCard key={l.id} load={l} onPress={noop} />)
        ) : (
          <EmptyState
            icon="event"
            title="No upcoming loads"
            subtitle="New assignments from dispatch will appear here."
          />
        )
      ) : null}

      {bucket === 'previous' ? (
        SAMPLE_PREVIOUS.map((l) => <LoadCard key={l.id} load={l} onPress={noop} />)
      ) : null}

      <Text className="pt-1 text-center text-xs text-ink-subtle">
        Sample data — live assignments arrive with the Loads phase.
      </Text>
    </Screen>
  );
}
