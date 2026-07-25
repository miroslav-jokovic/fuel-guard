import { Screen, EmptyState } from '@/components';

export default function Score() {
  return (
    <Screen>
      <EmptyState
        title="My Score"
        subtitle="Your weekly safety, efficiency, and idling score will show here. (Built in Phase 4.)"
      />
    </Screen>
  );
}
