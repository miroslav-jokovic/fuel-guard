import { Screen, EmptyState } from '@/components';

export default function FuelLog() {
  return (
    <Screen>
      <EmptyState
        title="Your fuel log"
        subtitle="Fill-ups you log will appear here with MPG and status. (Built in Phase 4.)"
      />
    </Screen>
  );
}
