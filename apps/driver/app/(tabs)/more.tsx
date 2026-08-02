import { useRouter } from 'expo-router';
import { Badge, ListRow, Screen, ScreenHeader, SectionLabel } from '@/components';
import { dutyView, useShift } from '@/features/duty/useDuty';

export default function More() {
  const router = useRouter();
  const shift = useShift();
  const duty = dutyView(shift.data);

  return (
    <Screen>
      <ScreenHeader title="More" />

      {duty.onDuty ? (
        <>
          <SectionLabel>On duty</SectionLabel>
          <ListRow
            icon="local_shipping"
            iconFill
            title={duty.equipmentLabel ?? 'On duty'}
            subtitle={duty.hasTrailer ? 'Truck and trailer' : 'Bobtail — no trailer yet'}
            onPress={() => router.push('/duty/check-in?mode=swap')}
          />
          <ListRow
            icon="logout"
            title="End shift"
            subtitle="Sign off and release your truck"
            onPress={() => router.push('/duty/end-shift')}
          />
        </>
      ) : null}

      <SectionLabel>App</SectionLabel>
      <ListRow
        title="Settings"
        subtitle="Profile, appearance, sign out"
        icon="settings"
        onPress={() => router.push('/settings')}
      />
      <ListRow
        title="Design system"
        subtitle="Component gallery (dev)"
        icon="explore"
        onPress={() => router.push('/gallery')}
      />

      <SectionLabel>Coming soon</SectionLabel>
      <ListRow
        title="Training"
        subtitle="Safety courses & quizzes"
        icon="school"
        right={<Badge label="Soon" tone="info" />}
      />
      <ListRow
        title="HazmatGuard"
        subtitle="Hazmat documentation in your load flow"
        icon="local_fire_department"
        right={<Badge label="Soon" tone="info" />}
      />
      <ListRow
        title="Ask FuelGuard"
        subtitle="AI copilot for your loads, route & score"
        icon="bolt"
        right={<Badge label="Soon" tone="info" />}
      />
    </Screen>
  );
}
